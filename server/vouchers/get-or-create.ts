import { Prisma, LedgerStatus, PayoutStatus, type AppRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { D, round2, sum } from "@/lib/money";
import { auditTx } from "@/lib/audit";
import { formatVoucherReference, clientInitialsOf } from "@/lib/pdf/voucher-reference";
import { canReadVoucher } from "@/lib/voucher-access";

export type VoucherPrincipal = { associateId: string | null; role: AppRole };

/** Thrown when `principal` may not read/issue a voucher for the given
 * associateId. The check lives HERE, inside the functions that touch
 * voucher data, not only in the routes that call them — the batched list
 * function in particular exists so a Server Component (A-6) can call it
 * directly, bypassing a route-level check entirely if the rule lived only
 * there. Callers map this to a 403. */
export class VoucherAccessDenied extends Error {}

export type VoucherLine = {
  lineType: string;
  comCode: string | null;
  amount: string;
  payoutMonth: string;
  paidDate: string; // ISO
};

type SettlingPayout = { payoutId: string; payoutMonth: string; paidDate: Date | null; total: Prisma.Decimal };

function sortSettlingPayouts(a: SettlingPayout, b: SettlingPayout): number {
  return (a.paidDate?.getTime() ?? 0) - (b.paidDate?.getTime() ?? 0)
    || a.payoutMonth.localeCompare(b.payoutMonth)
    || a.payoutId.localeCompare(b.payoutId);
}

/**
 * The associate's Paid, settling payouts across one or more transactions,
 * grouped by transactionId and ordered WITHIN each group by (paidDate,
 * payoutMonth, payoutId) — the single definition of "voucher seq order" AND
 * "voucher list order". Shared by getOrCreateVoucher (a voucher's seq is
 * this payout's 1-based POSITION here, never a count of existing vouchers)
 * and listVouchersForTransactions, so the two can never disagree. Every
 * requested transactionId gets an entry, `[]` when it has no settling
 * payout. Two queries regardless of how many transactionIds are passed —
 * the Received tab (A-6) can call this once for its whole scope instead of
 * once per row.
 */
async function orderedSettlingPayoutsByTransaction(transactionIds: string[], associateId: string): Promise<Map<string, SettlingPayout[]>> {
  const result = new Map<string, SettlingPayout[]>(transactionIds.map((id) => [id, []]));
  if (transactionIds.length === 0) return result;

  const lines = await prisma.commissionLedger.findMany({
    where: { transactionId: { in: transactionIds }, associateId, status: { not: LedgerStatus.Cancelled }, payout: { payoutStatus: PayoutStatus.Paid } },
    select: { transactionId: true, amount: true, payoutId: true, payout: { select: { payoutMonth: true, paidDate: true } } },
  });
  const byTxnPayout = new Map<string, Map<string, SettlingPayout>>();
  for (const l of lines) {
    if (!l.payoutId || !l.payout) continue;
    let byPayout = byTxnPayout.get(l.transactionId);
    if (!byPayout) { byPayout = new Map(); byTxnPayout.set(l.transactionId, byPayout); }
    const cur = byPayout.get(l.payoutId) ?? { payoutId: l.payoutId, payoutMonth: l.payout.payoutMonth, paidDate: l.payout.paidDate, total: D(0) };
    cur.total = cur.total.add(D(l.amount));
    byPayout.set(l.payoutId, cur);
  }
  for (const [transactionId, byPayout] of byTxnPayout) {
    result.set(transactionId, [...byPayout.values()].sort(sortSettlingPayouts));
  }
  return result;
}

/**
 * GET-only retrieval — an already-issued voucher, or null. NEVER creates
 * one (issuing is POST-only, getOrCreateVoucher below); a GET is a verb the
 * platform fires without a human (link prefetch, browser speculation,
 * crawlers), and any of those must not freeze an immutable financial
 * record nobody asked for.
 */
export async function getIssuedVoucher(
  transactionId: string,
  associateId: string,
  payoutId: string,
  principal: VoucherPrincipal,
) {
  if (!canReadVoucher({ associateId }, principal)) throw new VoucherAccessDenied();
  return prisma.paymentVoucher.findUnique({
    where: { transactionId_associateId_payoutId: { transactionId, associateId, payoutId } },
  });
}

/**
 * Get the (transaction, associate, payout) voucher, creating it on first
 * request (POST-only — see getIssuedVoucher above for the GET/read-only
 * path). One voucher per SETTLING payout — an instalment sale paid across
 * N payouts gets N vouchers, a sale paid in one go gets exactly one.
 * Frozen at issue: everything below the initial lookup only ever runs ONCE
 * per (transactionId, associateId, payoutId); every later call returns the
 * same row untouched, no matter what settles afterwards (on this
 * transaction or any other payout).
 *
 * "The lines paid for that transaction, by that payout" = this associate's
 * own (non-Cancelled) ledger lines on this transaction whose payoutId is
 * THIS payout — never any other payout's lines, even for the same
 * transaction/associate.
 *
 * Returns null when there's nothing to issue yet (no such transaction/
 * associate/payout, the payout isn't Paid, or it settled nothing on this
 * transaction for this associate) — the caller maps that to 404.
 */
export async function getOrCreateVoucher(
  transactionId: string,
  associateId: string,
  payoutId: string,
  principal: VoucherPrincipal,
  actorUserId?: string | null,
) {
  if (!canReadVoucher({ associateId }, principal)) throw new VoucherAccessDenied();

  const existing = await prisma.paymentVoucher.findUnique({
    where: { transactionId_associateId_payoutId: { transactionId, associateId, payoutId } },
  });
  if (existing) return existing;

  const [transaction, associate, payout, lines] = await Promise.all([
    prisma.salesTransaction.findUnique({ where: { id: transactionId }, select: { transactionCode: true, clientName: true } }),
    prisma.associate.findUnique({ where: { id: associateId }, select: { fullName: true, associateCode: true } }),
    prisma.monthlyPayout.findUnique({ where: { id: payoutId }, select: { payoutStatus: true, payoutMonth: true, paidDate: true } }),
    prisma.commissionLedger.findMany({
      where: { transactionId, associateId, payoutId, status: { not: LedgerStatus.Cancelled } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!transaction || !associate || !payout) return null;
  if (payout.payoutStatus !== PayoutStatus.Paid) return null; // only a SETTLED payout gets a voucher
  if (lines.length === 0) return null; // this payout settled nothing on this transaction for this associate
  // A Paid payout with no paidDate is a data defect (runPayouts always sets
  // one when it marks a payout Paid) — never paper over it by silently
  // stamping the issue date as the payment date.
  if (payout.paidDate === null) return null;

  // seq is this payout's 1-based POSITION among the associate's settling
  // payouts on this transaction, ordered by (paidDate, payoutMonth,
  // payoutId) — never a count of already-issued vouchers. A count races
  // two concurrent first-issues of DIFFERENT payouts onto the SAME seq
  // (and so the same `reference`, which IS unique — the loser then 404s
  // instead of getting its voucher), and it numbers by download order
  // rather than settlement order.
  const settling = (await orderedSettlingPayoutsByTransaction([transactionId], associateId)).get(transactionId)!;
  const seq = settling.findIndex((p) => p.payoutId === payoutId) + 1;
  if (seq === 0) return null; // this payout isn't in the settling set (shouldn't happen given the lines check above)

  const totalPaid = round2(sum(lines.map((l) => l.amount)));
  const paidDate = payout.paidDate;
  const voucherLines: VoucherLine[] = lines.map((l) => ({
    lineType: l.lineType,
    comCode: l.comCode,
    amount: l.amount.toFixed(2),
    payoutMonth: payout.payoutMonth,
    paidDate: paidDate.toISOString(),
  }));
  const reference = formatVoucherReference(transaction.transactionCode, associate.associateCode, seq);

  try {
    // Tier A: the row and its audit commit together, or neither does — an
    // issued financial document is never silently unrecorded.
    return await prisma.$transaction(async (tx) => {
      const created = await tx.paymentVoucher.create({
        data: {
          transactionId, associateId, payoutId, reference, seq,
          associateName: associate.fullName, associateCode: associate.associateCode, transactionCode: transaction.transactionCode,
          clientInitials: clientInitialsOf(transaction.clientName),
          payoutMonths: [payout.payoutMonth], paidDate,
          lines: voucherLines as unknown as Prisma.InputJsonValue,
          totalPaid, issuedById: actorUserId ?? null,
        },
      });
      await auditTx(tx, {
        action: "voucher.issued", entityType: "PaymentVoucher", entityId: created.id, actorUserId: actorUserId ?? null,
        after: { reference, transactionId, associateId, payoutId, totalPaid: totalPaid.toFixed(2) },
      });
      return created;
    });
  } catch (e) {
    // Only a genuine (transactionId, associateId, payoutId) race — the SAME
    // payout requested twice at once — is safe to resolve by reading the
    // winner's row. This create can only P2002 on one of two unique
    // constraints (the composite key or `reference`); with seq
    // deterministic, two concurrent SAME-payout callers build the
    // IDENTICAL composite key AND the identical reference, so this reads
    // back by the composite key and lets that answer decide: found = a
    // real concurrent same-payout race, return it; not found = the P2002
    // was a genuine reference collision between DIFFERENT payouts — seq
    // being deterministic should make that unreachable, so it's a real bug
    // and must surface, never silently become a wrong 404.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await prisma.paymentVoucher.findUnique({ where: { transactionId_associateId_payoutId: { transactionId, associateId, payoutId } } });
      if (raced) return raced;
    }
    throw e;
  }
}

export type VoucherListEntry = {
  payoutId: string;
  payoutMonth: string;
  paidDate: string | null;
  totalPaid: string;
  issued: boolean;
  voucherId?: string;
  reference?: string;
  seq?: number;
};

/**
 * Read-only: one row per payout that has settled something on this
 * transaction for this associate (Paid payouts only), oldest first —
 * whether or not its voucher has been issued (viewed) yet. Never creates a
 * voucher; that only happens via getOrCreateVoucher, on an explicit
 * view/download. Batched (A-6): the Received tab calls this ONCE for every
 * transaction in its scope — two queries total, never one pair per row
 * (the scope is unbounded, so a big downline's scope would otherwise fire
 * hundreds-to-thousands of concurrent queries). Every requested
 * transactionId is present in the returned map — `[]` when it has no
 * settling payout, never a missing key.
 *
 * `associateId` is a single scalar applied as an equality across the whole
 * `transactionId IN (...)` set in both queries below — a cross-associate
 * batch can't be expressed through this signature, so keep it that way
 * (never widen `associateId` to a list). `principal` is checked here, not
 * left to the caller, because this function is exactly the one a Server
 * Component (A-6) calls directly, bypassing any route-level check.
 */
export async function listVouchersForTransactions(transactionIds: string[], associateId: string, principal: VoucherPrincipal): Promise<Map<string, VoucherListEntry[]>> {
  if (!canReadVoucher({ associateId }, principal)) throw new VoucherAccessDenied();

  const result = new Map<string, VoucherListEntry[]>(transactionIds.map((id) => [id, []]));
  if (transactionIds.length === 0) return result;

  const [settlingByTxn, vouchers] = await Promise.all([
    orderedSettlingPayoutsByTransaction(transactionIds, associateId),
    prisma.paymentVoucher.findMany({ where: { transactionId: { in: transactionIds }, associateId } }),
  ]);
  const voucherByTxnPayout = new Map<string, Map<string, (typeof vouchers)[number]>>();
  for (const v of vouchers) {
    let byPayout = voucherByTxnPayout.get(v.transactionId);
    if (!byPayout) { byPayout = new Map(); voucherByTxnPayout.set(v.transactionId, byPayout); }
    byPayout.set(v.payoutId, v);
  }

  for (const transactionId of transactionIds) {
    const settling = settlingByTxn.get(transactionId) ?? [];
    const voucherByPayout = voucherByTxnPayout.get(transactionId);
    result.set(transactionId, settling.map((p) => {
      const voucher = voucherByPayout?.get(p.payoutId);
      return {
        payoutId: p.payoutId,
        payoutMonth: p.payoutMonth,
        paidDate: p.paidDate?.toISOString() ?? null,
        // An already-issued voucher's total is FROZEN at issue — never
        // recomputed from live ledger lines. A line Cancelled after issue
        // (the payout is immutable post-M5, a line's status isn't) must
        // not move the number the issued PDF already shows; only a
        // not-yet-issued row uses the live sum.
        totalPaid: voucher ? voucher.totalPaid.toFixed(2) : round2(p.total).toFixed(2),
        issued: !!voucher,
        voucherId: voucher?.id,
        reference: voucher?.reference,
        seq: voucher?.seq,
      };
    }));
  }
  return result;
}

/** Single-transaction convenience wrapper — implemented in terms of the
 * batched version above so there is exactly one code path. */
export async function listVouchersForTransaction(transactionId: string, associateId: string, principal: VoucherPrincipal): Promise<VoucherListEntry[]> {
  return (await listVouchersForTransactions([transactionId], associateId, principal)).get(transactionId)!;
}
