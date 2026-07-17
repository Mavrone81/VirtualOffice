"use server";

import { revalidatePath } from "next/cache";
import { Prisma, LedgerStatus, LedgerLineType, PayoutStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getAdminPrincipal } from "@/server/access";
import { reauth } from "@/lib/reauth";
import { buildBankFileCsv } from "@/server/payouts/bankfile";

/**
 * Generate the bank/GIRO bulk-payout CSV for a month — money leaving the
 * business, so it is gated by a FRESH password re-entry (a session cookie alone
 * is not enough authority) and every generation is audited. Returns the CSV
 * string on success; the route (POST) streams it as a download.
 */
export async function generateBankFile(
  month: string,
  password: string,
): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const t = await getTranslations("errors");
  const principal = await getAdminPrincipal();
  if (!principal) return { ok: false, error: t("forbidden") };
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: t("badMonth") };
  if (!(await reauth(principal.userId, password))) return { ok: false, error: t("reauthFailed") };

  const csv = await buildBankFileCsv(month, principal.userId);
  await logAudit({
    action: "payout.bankfile_generated",
    entityType: "MonthlyPayout",
    entityId: month,
    actorUserId: principal.userId,
  });
  return { ok: true, csv };
}

/** Aggregate this month's Eligible ledger lines into monthly_payouts per associate. */
export async function runPayouts(month: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const t = await getTranslations("errors");
  if (!(await getAdminPrincipal())) return { ok: false, error: t("forbidden") };
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: t("badMonth") };

  const lines = await prisma.commissionLedger.findMany({
    where: { payoutMonth: month, status: LedgerStatus.Eligible, associateId: { not: null } },
    include: { associate: true },
  });

  type Agg = { personal: Prisma.Decimal; override: Prisma.Decimal; addon: Prisma.Decimal; assoc: NonNullable<(typeof lines)[number]["associate"]> };
  const byAssoc = new Map<string, Agg>();
  for (const l of lines) {
    if (!l.associateId || !l.associate) continue;
    const a = byAssoc.get(l.associateId) ?? {
      personal: new Prisma.Decimal(0), override: new Prisma.Decimal(0), addon: new Prisma.Decimal(0), assoc: l.associate,
    };
    if (l.lineType === LedgerLineType.Personal) a.personal = a.personal.add(l.amount);
    else if (l.lineType === LedgerLineType.Override) a.override = a.override.add(l.amount);
    else if (l.lineType === LedgerLineType.AddOn) a.addon = a.addon.add(l.amount);
    byAssoc.set(l.associateId, a);
  }

  let count = 0;
  for (const [associateId, v] of byAssoc) {
    const total = v.personal.add(v.override).add(v.addon);
    await prisma.monthlyPayout.upsert({
      where: { associateId_payoutMonth: { associateId, payoutMonth: month } },
      update: { personalCommission: v.personal, overrideCommission: v.override, addonCommission: v.addon, totalPayable: total },
      create: {
        payoutMonth: month, associateId, associateName: v.assoc.fullName, designation: v.assoc.designation,
        personalCommission: v.personal, overrideCommission: v.override, addonCommission: v.addon, totalPayable: total,
        paymentMethod: v.assoc.paymentMethod, paynowNumber: v.assoc.paynowNumber,
        bankName: v.assoc.bankName, bankAccountNumber: v.assoc.bankAccountNumber, payoutStatus: PayoutStatus.Pending,
      },
    });
    count++;
  }
  await logAudit({ action: "payouts.run", entityType: "MonthlyPayout", entityId: month, after: { month, count } });
  revalidatePath("/admin/payouts");
  return { ok: true, count };
}

const ALLOWED_PAYOUT_TRANSITIONS: Partial<Record<PayoutStatus, PayoutStatus>> = {
  [PayoutStatus.Pending]: PayoutStatus.Approved,
  [PayoutStatus.Approved]: PayoutStatus.Paid,
};

export async function setPayoutStatus(payoutId: string, status: "Approved" | "Paid"): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!(await getAdminPrincipal())) return { ok: false, error: t("forbidden") };

  const cur = await prisma.monthlyPayout.findUnique({ where: { id: payoutId }, select: { payoutStatus: true } });
  if (!cur) return { ok: false, error: t("notFound") };

  const target = status === "Paid" ? PayoutStatus.Paid : PayoutStatus.Approved;
  if (ALLOWED_PAYOUT_TRANSITIONS[cur.payoutStatus] !== target) {
    return { ok: false, error: t("illegalPayoutTransition") };
  }

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
    where: { payoutMonth: month, payoutStatus: PayoutStatus.Pending },
    data: { payoutStatus: PayoutStatus.Approved },
  });
  await logAudit({ action: "payouts.approve_all", entityType: "MonthlyPayout", entityId: month, after: { month } });
  revalidatePath("/admin/payouts");
  return { ok: true };
}
