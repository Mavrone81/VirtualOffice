"use server";

import { revalidatePath } from "next/cache";
import { Prisma, LedgerStatus, PayoutKind, PayoutStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getAdminPrincipal } from "@/server/access";
import { reauth } from "@/lib/reauth";
import { buildBankFileCsv } from "@/server/payouts/bankfile";
import { recomputePendingPayout } from "@/server/payouts/totals";

/**
 * Generate the bank/GIRO bulk-payout CSV for a month — money leaving the
 * business, so it is gated by a FRESH password re-entry (a session cookie alone
 * is not enough authority) and every generation is audited. Returns the CSV
 * string on success; the route (POST) streams it as a download. Without
 * `batchId` it exports the month's not-yet-exported Approved payouts as a new
 * batch; with `batchId` it re-downloads that batch (M5 — never a fresh selection).
 */
export async function generateBankFile(
  month: string,
  password: string,
  batchId?: string,
): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const t = await getTranslations("errors");
  const principal = await getAdminPrincipal();
  if (!principal) return { ok: false, error: t("forbidden") };
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: t("badMonth") };
  if (!(await reauth(principal.userId, password))) return { ok: false, error: t("reauthFailed") };
  if (batchId && !/^[0-9a-f-]{36}$/i.test(batchId)) return { ok: false, error: t("notFound") };

  const file = await buildBankFileCsv(month, principal.userId, { batchId });
  await logAudit({
    action: batchId ? "payout.bankfile_redownloaded" : "payout.bankfile_generated",
    entityType: "BankFileBatch",
    entityId: file.batchId ?? month,
    after: { month, batchId: file.batchId, payoutIds: file.payoutIds, total: file.total },
    actorUserId: principal.userId,
  });
  return { ok: true, csv: file.csv };
}

/**
 * Settle this month's Eligible ledger lines into monthly_payouts, per associate.
 *
 * M5 — a payout is only ever written while it is Pending (compare-and-swap on
 * payoutStatus). Each line is attached to the payout that settles it (payoutId),
 * so a re-run only picks up lines not yet in any payout: they join the associate's
 * Pending payout for the month if there is one, otherwise they go into a new
 * Adjustment payout (seq + 1). Approved/Paid payouts are never modified.
 */
export async function runPayouts(month: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const t = await getTranslations("errors");
  const principal = await getAdminPrincipal();
  if (!principal) return { ok: false, error: t("forbidden") };
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: t("badMonth") };

  // Payouts approved/paid before payoutId existed have no attached lines. Until the
  // backfill links them, a re-run would treat their (already paid) lines as new.
  const legacy = await prisma.monthlyPayout.count({
    where: { payoutMonth: month, payoutStatus: { not: PayoutStatus.Pending }, ledgerLines: { none: {} } },
  });
  if (legacy > 0) return { ok: false, error: t("payoutsNotBackfilled") };

  const lines = await prisma.commissionLedger.findMany({
    where: { payoutMonth: month, status: LedgerStatus.Eligible, associateId: { not: null }, payoutId: null },
    include: { associate: true },
  });
  const byAssoc = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!l.associateId || !l.associate) continue;
    byAssoc.set(l.associateId, [...(byAssoc.get(l.associateId) ?? []), l]);
  }

  type Entry = { action: string; entityId: string; before?: Prisma.InputJsonValue; after: Prisma.InputJsonValue };
  const audits: Entry[] = [];
  try {
    for (const [associateId, assocLines] of byAssoc) {
      const assoc = assocLines[0].associate!;
      const lineIds = assocLines.map((l) => l.id);
      const entry = await prisma.$transaction(async (db): Promise<Entry> => {
        const latest = await db.monthlyPayout.findFirst({
          where: { associateId, payoutMonth: month }, orderBy: { seq: "desc" },
        });
        let payoutId: string;
        let action: string;
        let seq: number;
        if (latest?.payoutStatus === PayoutStatus.Pending) {
          payoutId = latest.id;
          seq = latest.seq;
          action = "payout.updated";
        } else {
          seq = latest ? latest.seq + 1 : 0;
          const created = await db.monthlyPayout.create({
            data: {
              payoutMonth: month, associateId, seq, kind: seq > 0 ? PayoutKind.Adjustment : PayoutKind.Regular,
              associateName: assoc.fullName, designation: assoc.designation,
              paymentMethod: assoc.paymentMethod, paynowNumber: assoc.paynowNumber,
              bankName: assoc.bankName, bankAccountNumber: assoc.bankAccountNumber, payoutStatus: PayoutStatus.Pending,
            },
          });
          payoutId = created.id;
          action = seq > 0 ? "payout.adjustment_created" : "payout.created";
        }
        const attached = await db.commissionLedger.updateMany({ where: { id: { in: lineIds }, payoutId: null }, data: { payoutId } });
        if (attached.count !== lineIds.length) throw new PayoutRunConflict();
        const change = await recomputePendingPayout(db, payoutId);
        if (!change) throw new PayoutRunConflict(); // payout left Pending mid-run
        return {
          action, entityId: payoutId,
          before: action === "payout.updated" ? change.before : undefined,
          after: { ...change.after, month, seq, addedLineIds: lineIds },
        };
      });
      audits.push(entry);
    }
  } catch (e) {
    // A concurrent run (or a concurrent approval) got there first: each associate's
    // step is its own transaction, so what already committed is audited below and
    // the rest is left for a retry, which is safe because it only picks up lines
    // that are still unattached. P2002 = two runs racing to create the same seq.
    const conflict = e instanceof PayoutRunConflict || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
    if (!conflict) throw e;
    await auditPayoutRun(audits, month, principal.userId, true);
    return { ok: false, error: t("payoutRunConflict") };
  }

  await auditPayoutRun(audits, month, principal.userId, false);
  revalidatePath("/admin/payouts");
  return { ok: true, count: audits.length };
}

class PayoutRunConflict extends Error {}

async function auditPayoutRun(
  audits: { action: string; entityId: string; before?: Prisma.InputJsonValue; after: Prisma.InputJsonValue }[],
  month: string, actorUserId: string, interrupted: boolean,
): Promise<void> {
  for (const a of audits) {
    await logAudit({ action: a.action, entityType: "MonthlyPayout", entityId: a.entityId, before: a.before, after: a.after, actorUserId });
  }
  await logAudit({ action: "payouts.run", entityType: "MonthlyPayout", entityId: month, after: { month, count: audits.length, interrupted }, actorUserId });
}

const ALLOWED_PAYOUT_TRANSITIONS: Partial<Record<PayoutStatus, PayoutStatus>> = {
  [PayoutStatus.Pending]: PayoutStatus.Approved,
  [PayoutStatus.Approved]: PayoutStatus.Paid,
};

export async function setPayoutStatus(payoutId: string, status: "Approved" | "Paid"): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!(await getAdminPrincipal())) return { ok: false, error: t("forbidden") };

  const cur = await prisma.monthlyPayout.findUnique({ where: { id: payoutId }, select: { payoutStatus: true, totalPayable: true } });
  if (!cur) return { ok: false, error: t("notFound") };

  const target = status === "Paid" ? PayoutStatus.Paid : PayoutStatus.Approved;
  if (ALLOWED_PAYOUT_TRANSITIONS[cur.payoutStatus] !== target) {
    return { ok: false, error: t("illegalPayoutTransition") };
  }
  // Zero/negative payouts are never approved for payment (M5; e.g. TXN-0003's −$296).
  if (target === PayoutStatus.Approved && cur.totalPayable.lte(0)) return { ok: false, error: t("payoutNotPositive") };

  // Compare-and-swap on the current status closes the TOCTOU window between the
  // read above and this write: if a concurrent transition already moved the row,
  // the where matches nothing and we reject rather than double-process (e.g. two
  // clicks both marking the same payout Paid).
  const result = await prisma.monthlyPayout.updateMany({
    where: { id: payoutId, payoutStatus: cur.payoutStatus },
    data: {
      payoutStatus: target,
      paidDate: status === "Paid" ? new Date() : undefined,
    },
  });
  if (result.count === 0) return { ok: false, error: t("illegalPayoutTransition") };
  await logAudit({ action: `payout.${status}`, entityType: "MonthlyPayout", entityId: payoutId });
  revalidatePath("/admin/payouts");
  return { ok: true };
}

export async function approveAllPayouts(month: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!(await getAdminPrincipal())) return { ok: false, error: t("forbidden") };
  await prisma.monthlyPayout.updateMany({
    // Zero/negative payouts stay Pending for a human to resolve (never exported).
    where: { payoutMonth: month, payoutStatus: PayoutStatus.Pending, totalPayable: { gt: 0 } },
    data: { payoutStatus: PayoutStatus.Approved },
  });
  await logAudit({ action: "payouts.approve_all", entityType: "MonthlyPayout", entityId: month, after: { month } });
  revalidatePath("/admin/payouts");
  return { ok: true };
}
