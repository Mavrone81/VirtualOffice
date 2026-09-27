"use server";

import { PayoutStatus, LedgerStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { getFullAdminPrincipal } from "@/server/access";

export type ReconcileCandidateLine = { id: string; transactionCode: string; payoutMonth: string; amount: string };
export type ReconcileTarget = { payoutId: string; totalPayable: string; lines: ReconcileCandidateLine[] };

/**
 * M5-CF Screen 3: for a blocked associate, the legacy Approved/Paid payout with
 * no linked lines (rev 5 E1 — reconcileLegacyPayout's target) plus the
 * candidate lines it might have already paid: the associate's currently-
 * unattached Eligible lines at month <= this payout's month, same set
 * findBlockedAssociateIds/buildCatchupPlan would otherwise try to pay
 * (server/payouts/catchup.ts). Read-only — no money math, just the display
 * data for the reconcile form's checklist. Business Admin only, same gate as
 * reconcileLegacyPayout itself — this is a callable Server Action, not just
 * page-gated UI, so it must check on its own.
 */
export async function getReconcileTarget(associateId: string): Promise<{ ok: true; target: ReconcileTarget | null } | { ok: false; error: string }> {
  const t = await getTranslations("errors");
  const principal = await getFullAdminPrincipal();
  if (!principal) return { ok: false, error: t("forbidden") };

  const payout = await prisma.monthlyPayout.findFirst({
    where: { associateId, payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] }, ledgerLines: { none: {} } },
    orderBy: { payoutMonth: "asc" },
    select: { id: true, payoutMonth: true, totalPayable: true },
  });
  if (!payout) return { ok: true, target: null };

  const lines = await prisma.commissionLedger.findMany({
    where: { associateId, payoutId: null, status: LedgerStatus.Eligible, payoutMonth: { lte: payout.payoutMonth } },
    include: { transaction: { select: { transactionCode: true } } },
    orderBy: { payoutMonth: "asc" },
  });

  return {
    ok: true,
    target: {
      payoutId: payout.id,
      totalPayable: payout.totalPayable.toString(),
      lines: lines.map((l) => ({ id: l.id, transactionCode: l.transaction.transactionCode, payoutMonth: l.payoutMonth, amount: l.amount.toString() })),
    },
  };
}
