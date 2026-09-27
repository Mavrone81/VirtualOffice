"use server";

import { revalidatePath } from "next/cache";
import { Prisma, LedgerStatus, PayoutKind, PayoutStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getAdminPrincipal, getFullAdminPrincipal } from "@/server/access";
import { reauth } from "@/lib/reauth";
import { buildBankFileCsv } from "@/server/payouts/bankfile";
import { recomputePendingPayout, payoutTotalsFromLines, totalsSnapshot } from "@/server/payouts/totals";
import { buildCatchupPlan, type AssociatePlan } from "@/server/payouts/catchup";
import { PolicyNotImplemented, currentNetNegativePolicy } from "@/server/payouts/policy";

/** C7/Frontend: the i18n error keys `previewPayoutRun`, `runPayouts` and
 *  `reconcileLegacyPayout` can return, exported so the client switch is exhaustive. */
export type PayoutErrorCode =
  | "forbidden" | "badMonth" | "payoutRunConflict" | "payoutPolicyNotImplemented"
  | "notFound" | "allFieldsRequired" | "illegalPayoutTransition" | "alreadyProcessed"
  | "legacyDifferenceRequired" | "legacyDifferenceMismatch";

function err(t: (k: string) => string, code: PayoutErrorCode): { ok: false; code: PayoutErrorCode; error: string } {
  return { ok: false, code, error: t(code) };
}

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
): Promise<{ ok: true; csv: string; batchId: string | null; reprint: boolean } | { ok: false; error: string }> {
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
  return { ok: true, csv: file.csv, batchId: file.batchId, reprint: !!batchId };
}

/**
 * Settle every unattached Eligible line whose earning month is <= M into
 * monthly_payouts, per associate (M5-CF §2: catch-up across months, not just M).
 *
 * M5 — a payout is only ever written while it is Pending (compare-and-swap on
 * payoutStatus). Each line is attached to the payout that settles it (payoutId),
 * so a re-run only picks up lines not yet in any payout: they join the associate's
 * Pending payout for the month if there is one, otherwise they go into a new
 * Adjustment payout (seq + 1). Approved/Paid payouts are never modified.
 *
 * CF additions: (1) rev 5 — an associate with an unreconciled legacy payout at
 * month <= M (E1: from before payoutId existed, or a `manual-*` case the M5
 * backfill declined) is skipped, not the whole run: they get nothing this run
 * (no catch-up, release or carry) and are listed in `blockedAssociateIds`, while
 * every other associate still runs; (2) a Pending payout stuck at total <= 0 in
 * an earlier month is released (Cancelled, its lines detached) and its lines
 * join this run's candidate set; (3) the net-negative policy
 * (server/payouts/policy.ts) decides whether to attach a non-positive net or
 * leave it for the next run.
 */
export async function runPayouts(
  month: string,
): Promise<
  | { ok: true; count: number; blockedAssociateIds: string[] }
  | { ok: false; code: PayoutErrorCode; error: string }
> {
  const t = await getTranslations("errors");
  const principal = await getAdminPrincipal();
  if (!principal) return err(t, "forbidden");
  if (!/^\d{4}-\d{2}$/.test(month)) return err(t, "badMonth");

  // I5/DevSecOps: an unimplemented policy (company_absorbs/recover) throws as soon
  // as buildCatchupPlan evaluates it against a non-positive net, which can happen
  // before any per-associate transaction even opens — catch it here too, not only
  // inside the loop below, so it's always a clean error, never a raw 500.
  let plans: Awaited<ReturnType<typeof buildCatchupPlan>>;
  try {
    plans = await buildCatchupPlan(prisma, month);
  } catch (e) {
    if (e instanceof PolicyNotImplemented) return err(t, "payoutPolicyNotImplemented");
    throw e;
  }
  const associates = await prisma.associate.findMany({ where: { id: { in: plans.map((p) => p.associateId) } } });
  const assocById = new Map(associates.map((a) => [a.id, a]));

  type Entry = { action: string; entityId: string; before?: Prisma.InputJsonValue; after: Prisma.InputJsonValue };
  const audits: Entry[] = [];
  const blockedAssociateIds: string[] = [];
  // Associates actually touched this run — NOT audits.length: an associate whose
  // stuck payout is released AND who gets a new attach in the same run produces
  // two audit entries, but is one associate.
  let processedCount = 0;
  let policyError: string | null = null;
  outer: for (const plan of plans) {
    if (plan.blocked) {
      blockedAssociateIds.push(plan.associateId);
      continue;
    }
    if (plan.newLines.length === 0 && plan.stuckPayouts.length === 0) continue;
    const assoc = assocById.get(plan.associateId);
    if (!assoc) continue;
    try {
      const entries = await prisma.$transaction(async (db): Promise<Entry[]> => {
        return applyAssociatePlan(db, month, plan, assoc);
      });
      if (entries.length) processedCount++;
      audits.push(...entries);
    } catch (e) {
      if (e instanceof AssociateBlockedByLegacy) {
        // rev 5: re-checked inside the lock — became legacy-blocked between the
        // outer plan read and this associate's turn. Skip them, keep going.
        blockedAssociateIds.push(plan.associateId);
        continue;
      }
      if (e instanceof PolicyNotImplemented) {
        policyError = e.policy;
        break outer;
      }
      // A concurrent run (or a concurrent approval) got there first: each associate's
      // step is its own transaction, so what already committed is audited below and
      // the rest is left for a retry, which is safe because it only picks up lines
      // that are still unattached. P2002 = two runs racing to create the same seq;
      // P2028/P2034 = a transaction timeout or serialization failure (C3/DevLead) —
      // also safe to treat as "run interrupted, retry", not a hard failure.
      const conflict =
        e instanceof PayoutRunConflict ||
        (e instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2028", "P2034"].includes(e.code));
      // C3/DevLead: whatever already committed in this loop must always be
      // audited, even when the error isn't a recognised conflict — otherwise a
      // deadlock or an unexpected error leaves committed steps with no trail.
      await auditPayoutRun(audits, month, principal.userId, true, blockedAssociateIds, processedCount);
      if (!conflict) throw e;
      return err(t, "payoutRunConflict");
    }
  }
  if (policyError) {
    await auditPayoutRun(audits, month, principal.userId, true, blockedAssociateIds, processedCount);
    return err(t, "payoutPolicyNotImplemented");
  }

  await auditPayoutRun(audits, month, principal.userId, false, blockedAssociateIds, processedCount);
  revalidatePath("/admin/payouts");
  return { ok: true, count: processedCount, blockedAssociateIds };
}

class AssociateBlockedByLegacy extends Error {}

type Entry = { action: string; entityId: string; before?: Prisma.InputJsonValue; after: Prisma.InputJsonValue };

/** One associate's share of a run: release any stuck payouts, then attach or carry per the plan's decision. */
async function applyAssociatePlan(
  db: Prisma.TransactionClient, month: string, plan: AssociatePlan,
  assoc: { fullName: string; designation: import("@prisma/client").Designation; paymentMethod: import("@prisma/client").PaymentMethod | null; paynowNumber: string | null; bankName: string | null; bankAccountNumber: string | null },
): Promise<Entry[]> {
  const { associateId } = plan;
  // Global money lock order (E2): ledger lines (selected + every stuck payout's own
  // lines), then payouts (the stuck ones + the associate's latest for M). ORDER BY id
  // on both (C4/DevLead): two overlapping runs (a double-click, or runs for M and
  // M-1 sharing unattached lines) must lock in a consistent order or they can deadlock.
  const stuckIds = plan.stuckPayouts.map((p) => p.id);
  const newLineIds = plan.newLines.map((l) => l.id);
  // Architect nit: the existing Pending-M payout's own lines (C1 may detach
  // them) belong in this same ledger lock — otherwise they're only locked via
  // the payout row below, i.e. payout -> ledger, reversed from the global
  // order, which can deadlock (safely retried via P2034, but avoidable).
  const payoutLockIds = plan.existingPendingPayoutId ? [...stuckIds, plan.existingPendingPayoutId] : stuckIds;
  await db.$queryRaw`SELECT id FROM commission_ledger WHERE id = ANY(${newLineIds}::uuid[]) OR payout_id = ANY(${payoutLockIds}::uuid[]) ORDER BY id FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM monthly_payouts WHERE id = ANY(${payoutLockIds}::uuid[]) OR (associate_id = ${associateId}::uuid AND payout_month = ${month}) ORDER BY id FOR UPDATE`;

  // Rev 5: re-check for a legacy-unlinked payout now that we hold the locks — the
  // outer plan was read before them, so this catches one that appeared in between.
  const stillBlocked = await db.monthlyPayout.count({
    where: { associateId, payoutMonth: { lte: month }, payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] }, ledgerLines: { none: {} } },
  });
  if (stillBlocked > 0) throw new AssociateBlockedByLegacy();

  /**
   * Detach a Pending payout's lines and CAS it to Cancelled. Used both for an
   * earlier month's stuck payout and (C1/Architect) this month's own payout
   * when the net-negative policy declines to attach — otherwise that payout
   * would stay Pending, get approved and paid, while the negative net "carries"
   * alongside it: the associate ends up paid despite a negative net position.
   *
   * Freshness check before releasing (C5/DevSecOps): re-read the payout under
   * the lock rather than trusting the pre-lock plan.
   * - A **stuck** payout (an earlier month) must still be Pending and <= 0 — its
   *   own total is the reason it's "stuck"; if a concurrent recompute already
   *   moved it (or made it positive), it's no longer stuck and releasing it now
   *   would be wrong, so this conflicts instead.
   * - This month's **existing Pending** payout (C1/Architect) is released
   *   because the ASSOCIATE'S COMBINED net is <= 0, not because its own total
   *   is non-positive (it's often positive, e.g. +100 before a later -300
   *   makes the combined net -200) — so the check here is that its total
   *   still matches what the plan saw, not that it's non-positive.
   */
  async function releasePayout(
    payoutId: string, expectedTotal: Prisma.Decimal, requireNonPositive: boolean, fromMonth: string, remarks: string,
  ): Promise<string[]> {
    const fresh = await db.monthlyPayout.findUnique({ where: { id: payoutId }, select: { payoutStatus: true, totalPayable: true } });
    const stale = !fresh || fresh.payoutStatus !== PayoutStatus.Pending
      || (requireNonPositive ? fresh.totalPayable.gt(0) : !fresh.totalPayable.equals(expectedTotal));
    if (stale) throw new PayoutRunConflict();
    const lines = await db.commissionLedger.findMany({ where: { payoutId }, select: { id: true } });
    await db.commissionLedger.updateMany({ where: { payoutId }, data: { payoutId: null } });
    const zero = payoutTotalsFromLines([]);
    const cas = await db.monthlyPayout.updateMany({
      where: { id: payoutId, payoutStatus: PayoutStatus.Pending },
      data: { ...zero, payoutStatus: PayoutStatus.Cancelled, remarks },
    });
    if (cas.count !== 1) throw new PayoutRunConflict();
    entries.push({
      action: "payout.carried_forward", entityId: payoutId,
      before: { totalPayable: fresh.totalPayable.toFixed(2) },
      after: { fromMonth, toMonth: month, lineIds: lines.map((l) => l.id), amount: fresh.totalPayable.toFixed(2) },
    });
    return lines.map((l) => l.id);
  }

  const entries: Entry[] = [];
  const releasedLineIds: string[] = [];
  for (const p of plan.stuckPayouts) {
    releasedLineIds.push(...(await releasePayout(p.id, p.totalPayable, true, p.payoutMonth, `carried forward to ${month}`)));
  }

  if (!plan.attach) {
    // carry_forward (or any policy that declines): leave everything unattached —
    // including the just-released lines — so the next run picks them all up.
    // C1/Architect: this month's OWN existing Pending payout must be released
    // too, or it stays payable while the associate's net position is negative.
    if (plan.existingPendingPayoutId) {
      await releasePayout(plan.existingPendingPayoutId, plan.existingPendingTotal, false, month, "carried forward (net <= 0)");
    }
    return entries;
  }
  if (plan.newLines.length === 0 && releasedLineIds.length === 0) return entries;

  const lineIds = [...newLineIds, ...releasedLineIds];
  const latest = await db.monthlyPayout.findFirst({ where: { associateId, payoutMonth: month }, orderBy: { seq: "desc" } });
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
  // C6/DevLead: status + associateId in the where is defence in depth — a
  // recompute deletes and recreates lines rather than changing their status, so
  // a stale id here already gives a count mismatch (-> conflict) either way.
  const attached = await db.commissionLedger.updateMany({
    where: { id: { in: lineIds }, payoutId: null, status: LedgerStatus.Eligible, associateId },
    data: { payoutId },
  });
  if (attached.count !== lineIds.length) throw new PayoutRunConflict();
  const change = await recomputePendingPayout(db, payoutId);
  if (!change) throw new PayoutRunConflict(); // payout left Pending mid-run
  if (plan.note) await db.monthlyPayout.update({ where: { id: payoutId }, data: { remarks: plan.note } });
  entries.push({
    action, entityId: payoutId,
    before: action === "payout.updated" ? change.before : undefined,
    after: { ...change.after, month, seq, addedLineIds: lineIds, policy: plan.policyName },
  });
  return entries;
}

class PayoutRunConflict extends Error {}

/**
 * Read-only preview of what `runPayouts(month)` would do, for the "Run payouts"
 * screen and the required first-run sign-off (M5-CF §2b, F1). Shares
 * `buildCatchupPlan` with the real run and writes nothing — the transaction itself
 * is set read-only, so any write anywhere in this path fails outright rather than
 * relying on the caller not to add one later.
 */
export async function previewPayoutRun(month: string): Promise<
  | {
      ok: true;
      plans: { associateId: string; associateName: string; newLines: number; releasedLines: number; net: string; attach: boolean; policy: string; note?: string; isLeaver: boolean }[];
      blockedAssociateIds: string[];
    }
  | { ok: false; code: PayoutErrorCode; error: string }
> {
  const t = await getTranslations("errors");
  const principal = await getAdminPrincipal();
  if (!principal) return err(t, "forbidden");
  if (!/^\d{4}-\d{2}$/.test(month)) return err(t, "badMonth");

  try {
    const result = await prisma.$transaction(async (db) => {
      await db.$executeRaw`SET TRANSACTION READ ONLY`;
      const plans = await buildCatchupPlan(db, month);
      const associates = await db.associate.findMany({ where: { id: { in: plans.map((p) => p.associateId) } }, select: { id: true, fullName: true, associateStatus: true } });
      const byId = new Map(associates.map((a) => [a.id, a]));
      // ⓢ Q33b: "leaver" = inactive or terminated — flagged so a negative carry
      // shows "recover manually" rather than looking like an ordinary carry.
      const isLeaver = (id: string) => {
        const s = byId.get(id)?.associateStatus;
        return s === "Inactive" || s === "Terminated";
      };
      return {
        blockedAssociateIds: plans.filter((p) => p.blocked).map((p) => p.associateId),
        rows: plans
          .filter((p) => !p.blocked && (p.newLines.length > 0 || p.stuckPayouts.length > 0))
          .map((p) => ({
            associateId: p.associateId, associateName: byId.get(p.associateId)?.fullName ?? "",
            newLines: p.newLines.length, releasedLines: p.releasedLines.length,
            net: p.net.toFixed(2), attach: p.attach, policy: p.policyName, note: p.note,
            isLeaver: isLeaver(p.associateId),
          })),
      };
    });
    return { ok: true, plans: result.rows, blockedAssociateIds: result.blockedAssociateIds };
  } catch (e) {
    if (e instanceof PolicyNotImplemented) return err(t, "payoutPolicyNotImplemented");
    throw e;
  }
}

/**
 * M5-CF §2a: attach a legacy Approved/Paid payout (no linked lines, from before
 * payoutId existed) to the candidate lines that Accounts has confirmed it actually
 * paid, against bank records. Business Admin only. The payout's own totals are
 * NEVER changed (M5 immutability) — this only links; any gap between what the
 * lines sum to and what was actually paid is recorded, not corrected here.
 * Runs once per payout: a payout with any linked line already is refused, so a
 * later correction must go through a separate, audited amend path.
 */
export async function reconcileLegacyPayout(
  payoutId: string, lineIds: string[], reason: string, difference?: { amount: string; reason: string },
): Promise<{ ok: true } | { ok: false; code: PayoutErrorCode; error: string }> {
  const t = await getTranslations("errors");
  const principal = await getFullAdminPrincipal();
  if (!principal) return err(t, "forbidden");
  if (!reason.trim()) return err(t, "allFieldsRequired");
  if (lineIds.length === 0) return err(t, "allFieldsRequired");

  const result = await prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM commission_ledger WHERE id = ANY(${lineIds}::uuid[]) ORDER BY id FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM monthly_payouts WHERE id = ${payoutId}::uuid ORDER BY id FOR UPDATE`;

    const payout = await db.monthlyPayout.findUnique({ where: { id: payoutId } });
    if (!payout) return err(t, "notFound");
    if (payout.payoutStatus === PayoutStatus.Pending || payout.payoutStatus === PayoutStatus.Cancelled) {
      return err(t, "illegalPayoutTransition");
    }
    const alreadyLinked = await db.commissionLedger.count({ where: { payoutId } });
    if (alreadyLinked > 0) return err(t, "alreadyProcessed");

    // C1: candidate lines must actually belong to this payout's associate, be
    // Eligible, and be earned no later than the payout's own month — otherwise a
    // wrong id links one associate's lines to another's legacy payout, and since
    // "received" is derived from the payout (R-6), the wrong person shows as paid.
    const candidateWhere = {
      id: { in: lineIds }, payoutId: null,
      associateId: payout.associateId, status: LedgerStatus.Eligible,
      payoutMonth: { lte: payout.payoutMonth },
    };
    const lines = await db.commissionLedger.findMany({ where: candidateWhere, select: { id: true, amount: true } });
    if (lines.length !== lineIds.length) return err(t, "payoutRunConflict");

    const attachedSum = lines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));
    const paidTotal = payout.totalPayable;
    const gap = attachedSum.sub(paidTotal);
    if (!attachedSum.equals(paidTotal)) {
      // ✚F2: a mismatch needs a re-typed amount + reason before it can be recorded,
      // and the re-typed amount must equal the actual gap — not just be present.
      if (!difference) return err(t, "legacyDifferenceRequired");
      if (!difference.reason.trim()) return err(t, "legacyDifferenceRequired");
      let typedAmount: Prisma.Decimal;
      try {
        typedAmount = new Prisma.Decimal(difference.amount);
      } catch {
        return err(t, "legacyDifferenceMismatch"); // non-numeric input is never a raw 500
      }
      if (!typedAmount.equals(gap)) return err(t, "legacyDifferenceMismatch");
    }

    const attach = await db.commissionLedger.updateMany({ where: candidateWhere, data: { payoutId } });
    if (attach.count !== lineIds.length) return err(t, "payoutRunConflict");

    await logAudit({
      action: "payout.legacy_reconciled", entityType: "MonthlyPayout", entityId: payoutId, actorUserId: principal.userId,
      after: {
        lineIds, paidTotal: paidTotal.toFixed(2), attachedSum: attachedSum.toFixed(2),
        difference: attachedSum.sub(paidTotal).toFixed(2), reason,
        ...(difference ? { confirmedDifferenceAmount: difference.amount, differenceReason: difference.reason } : {}),
      },
    });
    return { ok: true as const };
  });

  if (result.ok) revalidatePath("/admin/payouts");
  return result;
}

async function auditPayoutRun(
  audits: { action: string; entityId: string; before?: Prisma.InputJsonValue; after: Prisma.InputJsonValue }[],
  month: string, actorUserId: string, interrupted: boolean, blockedAssociateIds: string[] = [], processedCount = 0,
): Promise<void> {
  for (const a of audits) {
    await logAudit({ action: a.action, entityType: "MonthlyPayout", entityId: a.entityId, before: a.before, after: a.after, actorUserId });
  }
  await logAudit({
    action: "payouts.run", entityType: "MonthlyPayout", entityId: month,
    after: { month, count: processedCount, interrupted, blockedAssociateIds, policy: currentNetNegativePolicy().name },
    actorUserId,
  });
}

const ALLOWED_PAYOUT_TRANSITIONS: Partial<Record<PayoutStatus, PayoutStatus>> = {
  [PayoutStatus.Pending]: PayoutStatus.Approved,
  [PayoutStatus.Approved]: PayoutStatus.Paid,
};

/**
 * B-7 (DevLead): lock every sales_transactions row this payout's ledger lines
 * belong to, in id order, BEFORE the payout's own CAS — the global lock order
 * (sale -> ledger -> payout) applied here so a concurrent B-7 unmark (which
 * locks the sale first, then checks payout.payoutStatus) serialises against
 * this transition instead of racing it: either the unmark's guard already
 * sees this payout as Approved/Paid, or this transition waits behind the
 * unmark's lock and only proceeds once it has committed (or rolled back).
 * Ordering by id avoids a deadlock between two payouts that share a
 * transaction (a split sale) locked in different orders.
 */
async function lockPayoutTransactions(db: Prisma.TransactionClient, payoutId: string): Promise<void> {
  await db.$queryRaw`
    SELECT id FROM sales_transactions
    WHERE id IN (SELECT DISTINCT transaction_id FROM commission_ledger WHERE payout_id = ${payoutId}::uuid)
    ORDER BY id FOR UPDATE
  `;
}

export async function setPayoutStatus(payoutId: string, status: "Approved" | "Paid"): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const principal = await getAdminPrincipal();
  if (!principal) return { ok: false, error: t("forbidden") };

  const cur = await prisma.monthlyPayout.findUnique({ where: { id: payoutId }, select: { payoutStatus: true, totalPayable: true } });
  if (!cur) return { ok: false, error: t("notFound") };

  const target = status === "Paid" ? PayoutStatus.Paid : PayoutStatus.Approved;
  if (ALLOWED_PAYOUT_TRANSITIONS[cur.payoutStatus] !== target) {
    return { ok: false, error: t("illegalPayoutTransition") };
  }
  // Zero/negative payouts are never approved for payment (M5; e.g. TXN-0003's −$296).
  if (target === PayoutStatus.Approved && cur.totalPayable.lte(0)) return { ok: false, error: t("payoutNotPositive") };

  // Compare-and-swap on the status AND the total read above closes the TOCTOU window
  // between that read and this write: if a concurrent transition moved the row, or a
  // recompute changed the total (C2), the where matches nothing and we reject rather
  // than approve a figure nobody checked (or double-process two clicks on Paid).
  const result = await prisma.$transaction(async (db) => {
    await lockPayoutTransactions(db, payoutId);
    return db.monthlyPayout.updateMany({
      where: { id: payoutId, payoutStatus: cur.payoutStatus, totalPayable: cur.totalPayable },
      data: {
        payoutStatus: target,
        paidDate: status === "Paid" ? new Date() : undefined,
      },
    });
  });
  if (result.count === 0) return { ok: false, error: t("illegalPayoutTransition") };
  await logAudit({
    action: `payout.${status}`, entityType: "MonthlyPayout", entityId: payoutId, actorUserId: principal.userId,
    before: { status: cur.payoutStatus, total: cur.totalPayable.toFixed(2) },
    after: { status: target, total: cur.totalPayable.toFixed(2) },
  });
  revalidatePath("/admin/payouts");
  return { ok: true };
}

export async function approveAllPayouts(month: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const principal = await getAdminPrincipal();
  if (!principal) return { ok: false, error: t("forbidden") };

  // Candidates, in id order (B-7/DevLead: a consistent lock order across
  // payouts avoids a deadlock with a concurrent call locking the same set).
  const candidates = await prisma.monthlyPayout.findMany({
    where: { payoutMonth: month, payoutStatus: PayoutStatus.Pending, totalPayable: { gt: 0 } },
    orderBy: { id: "asc" },
    select: { id: true },
  });

  const approved: { id: string; total: string }[] = [];
  for (const { id } of candidates) {
    const row = await prisma.$transaction(async (db) => {
      await lockPayoutTransactions(db, id);
      return db.monthlyPayout.updateManyAndReturn({
        where: { id, payoutStatus: PayoutStatus.Pending, totalPayable: { gt: 0 } },
        data: { payoutStatus: PayoutStatus.Approved },
        select: { id: true, totalPayable: true },
      });
    });
    if (row.length) approved.push({ id: row[0].id, total: row[0].totalPayable.toFixed(2) });
  }

  await logAudit({
    action: "payouts.approve_all", entityType: "MonthlyPayout", entityId: month, actorUserId: principal.userId,
    after: { month, count: approved.length, payouts: approved },
  });
  revalidatePath("/admin/payouts");
  return { ok: true };
}
