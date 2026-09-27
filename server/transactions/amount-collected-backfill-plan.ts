import type { Prisma, PrismaClient } from "@prisma/client";
import { InvoiceStatus } from "@prisma/client";
import { format } from "date-fns";
import { ZERO, clamp, eq, round2, sum } from "@/lib/money";

/**
 * A-0 backfill PLAN — read-only. For every SalesTransaction, recomputes what
 * amountCollected should be (Σ paid invoice amounts + Σ paid installment
 * dueAmounts, clamped to [0, saleAmount] — the same logic as
 * recomputeAmountCollected) and compares it to the stored value.
 *
 * Classes (naming matches reviews/a0-backfill-runbook.md and
 * migration-designs.md §1 — Samuel reviews the per-month table and every
 * `manual-*` row before any apply):
 *  - "clean": already correct, nothing to do.
 *  - "to-update": computed differs from stored, 0 ≤ computed ≤ saleAmount —
 *    a future apply step only ever touches these rows.
 *  - "manual-over-collected" (M1, Architect money review): the RAW
 *    (unclamped) sum exceeds saleAmount — a duplicate invoice or a schedule
 *    bug. Never auto-corrected past the clamp; a human decides.
 *  - "manual-deposit-rule-pending": an installment plan with a deposit but NO
 *    sequence-0 schedule row predates the deposit-row change (Samuel, Q9) —
 *    whether that deposit was ever actually collected isn't recorded
 *    anywhere, so it is never assumed either way.
 */
export type AmountCollectedBackfillRow = {
  transactionId: string;
  transactionCode: string;
  salesMonth: string; // YYYY-MM, from salesDate — for the per-month table
  saleAmount: string;
  storedAmountCollected: string;
  computedAmountCollected: string; // clamped — what would be WRITTEN by an apply
  rawCollected: string; // unclamped Σ; differs from computed only when over-collected
  action: "clean" | "to-update" | "manual-over-collected" | "manual-deposit-rule-pending";
};

export async function planAmountCollectedBackfill(
  db: PrismaClient | Prisma.TransactionClient,
): Promise<AmountCollectedBackfillRow[]> {
  const transactions = await db.salesTransaction.findMany({
    select: {
      id: true, transactionCode: true, salesDate: true, saleAmount: true, amountCollected: true,
      invoices: { where: { status: InvoiceStatus.Paid }, select: { amount: true } },
      installmentPlan: { select: { deposit: true, schedule: { select: { sequence: true, dueAmount: true, paid: true } } } },
    },
    orderBy: { transactionCode: "asc" },
  });

  const rows: AmountCollectedBackfillRow[] = [];
  for (const t of transactions) {
    const paidInstallments = t.installmentPlan?.schedule.filter((s) => s.paid) ?? [];
    const raw = round2(sum([...t.invoices.map((i) => i.amount), ...paidInstallments.map((s) => s.dueAmount)]));
    const computed = clamp(raw, ZERO, t.saleAmount);
    const overCollected = raw.gt(t.saleAmount);

    const hasDepositRow = t.installmentPlan?.schedule.some((s) => s.sequence === 0) ?? false;
    const predatesDepositRow = !!t.installmentPlan && t.installmentPlan.deposit.gt(0) && !hasDepositRow;

    const action: AmountCollectedBackfillRow["action"] = predatesDepositRow
      ? "manual-deposit-rule-pending"
      : overCollected
        ? "manual-over-collected"
        : eq(computed, t.amountCollected)
          ? "clean"
          : "to-update";

    rows.push({
      transactionId: t.id,
      transactionCode: t.transactionCode,
      salesMonth: format(t.salesDate, "yyyy-MM"),
      saleAmount: t.saleAmount.toFixed(2),
      storedAmountCollected: t.amountCollected.toFixed(2),
      computedAmountCollected: computed.toFixed(2),
      rawCollected: raw.toFixed(2),
      action,
    });
  }
  return rows;
}

export type MonthSummaryRow = {
  month: string;
  transactions: number;
  collectedBefore: string; // Σ stored, this month
  collectedAfter: string; // Σ (manual rows keep `stored`; clean/to-update contribute `computed`) — what an apply touching only to-update rows would leave
  toUpdate: number;
  manual: number;
};

/** Per-month (salesDate) before/after summary — the M5-pattern artefact Architect/DevLead asked for (M2). */
export function summariseByMonth(rows: AmountCollectedBackfillRow[]): MonthSummaryRow[] {
  const months = [...new Set(rows.map((r) => r.salesMonth))].sort();
  return months.map((month) => {
    const mr = rows.filter((r) => r.salesMonth === month);
    const before = sum(mr.map((r) => r.storedAmountCollected));
    const after = sum(mr.map((r) => (r.action.startsWith("manual") ? r.storedAmountCollected : r.computedAmountCollected)));
    return {
      month,
      transactions: mr.length,
      collectedBefore: before.toFixed(2),
      collectedAfter: after.toFixed(2),
      toUpdate: mr.filter((r) => r.action === "to-update").length,
      manual: mr.filter((r) => r.action.startsWith("manual")).length,
    };
  });
}
