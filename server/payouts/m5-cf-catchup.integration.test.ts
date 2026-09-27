// M5-CF (reviews/m5-cf-design.md, rev 5): catch-up across months, carry-forward,
// the stuck-payout release, the per-associate E1 guard, previewPayoutRun and the
// net-negative policy. Ledger lines are created directly (not via the full
// sale->invoice->paid pipeline) so amounts/months/status are exact and the tests
// stay fast; each still hangs off one real SalesTransaction per associate for the
// FK. Needs a local PG (DATABASE_URL); fake data only, all rows tagged and
// cleaned up. Months are in the 2199 range, reserved so this file never collides
// with any other integration test sharing the same throwaway database (it runs
// sequentially with other *.integration.test.ts files — vitest.config.ts).
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { LedgerLineType, LedgerStatus, PayoutStatus } from "@prisma/client";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { runPayouts, previewPayoutRun, reconcileLegacyPayout, setPayoutStatus } from "./actions";

const TAG = "M5CF-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const ACCOUNTS = { user: { associateId: null, id: "22222222-2222-2222-2222-222222222222", role: "Accounts" } };

const assocSeq = { n: 0 };

async function mkAssoc(status: "Active" | "Terminated" = "Active") {
  assocSeq.n++;
  const a = await prisma.associate.create({
    data: {
      associateCode: `${TAG}A${assocSeq.n}`, fullName: `${TAG}A${assocSeq.n}`,
      designation: "SalesAssociate", approvalStatus: "Approved", associateStatus: status,
    },
    select: { id: true },
  });
  return a.id;
}

/** A throwaway closed transaction to hang ledger lines off (FK only; amounts are irrelevant). */
async function mkTransaction(associateId: string, salesDate: string) {
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date(salesDate), clientName: TAG + "Client", saleAmount: "1000", paymentPlan: "FullPayment",
      closingAssociateId: associateId, status: "QuotationApproved", closedAt: new Date(),
    },
    select: { id: true },
  });
  const tx = await prisma.salesTransaction.create({
    data: {
      transactionCode: `${TAG}TXN-${sub.id.slice(0, 8)}`, submissionId: sub.id, salesDate: new Date(salesDate),
      clientName: TAG + "Client", saleAmount: "1000", paymentPlan: "FullPayment", closingAssociateId: associateId,
      commissionEligibility: "Eligible",
    },
    select: { id: true },
  });
  return tx.id;
}

async function mkLine(transactionId: string, associateId: string, month: string, amount: string, status: LedgerStatus = LedgerStatus.Eligible) {
  return prisma.commissionLedger.create({
    data: {
      transactionId, payoutMonth: month, associateId, lineType: LedgerLineType.Personal,
      basisAmount: "1000", amount, eligibility: "Eligible", status,
    },
  });
}

/** Architect §11 invariant: Σ non-Cancelled payouts + Σ unattached Eligible = Σ Eligible lines. */
async function assertConservation(associateId: string) {
  const lines = await prisma.commissionLedger.findMany({ where: { associateId, status: LedgerStatus.Eligible }, select: { amount: true, payoutId: true } });
  const payouts = await prisma.monthlyPayout.findMany({ where: { associateId, payoutStatus: { not: PayoutStatus.Cancelled } }, select: { totalPayable: true } });
  const totalLines = lines.reduce((s, l) => s + Number(l.amount), 0);
  const unattached = lines.filter((l) => l.payoutId === null).reduce((s, l) => s + Number(l.amount), 0);
  const inPayouts = payouts.reduce((s, p) => s + Number(p.totalPayable), 0);
  expect(inPayouts + unattached).toBeCloseTo(totalLines, 2);
}

/** No associate has an Approved/Paid payout while their still-unattached net is negative. */
async function assertNeverPaidWhileNegative(associateId: string) {
  const approvedOrPaid = await prisma.monthlyPayout.findMany({
    where: { associateId, payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] } },
    select: { totalPayable: true },
  });
  if (approvedOrPaid.length === 0) return;
  const unattached = await prisma.commissionLedger.findMany({
    where: { associateId, status: LedgerStatus.Eligible, payoutId: null }, select: { amount: true },
  });
  const unattachedNet = unattached.reduce((s, l) => s + Number(l.amount), 0);
  const approvedOrPaidTotal = approvedOrPaid.reduce((s, p) => s + Number(p.totalPayable), 0);
  expect(approvedOrPaidTotal + unattachedNet).toBeGreaterThanOrEqual(0);
}

async function runAsAdmin(month: string) {
  who.session = ADMIN;
  return runPayouts(month);
}

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.monthlyPayout.deleteMany({ where: { associate: mine } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.associate.deleteMany({ where: mine });
});

// The policy is read fresh from process.env on every call (server/payouts/policy.ts),
// not from an ambient .env value — CI never sets PAYOUT_NET_NEGATIVE_POLICY, so every
// test here sets exactly the policy it needs. Most tests want carry_forward; tests 10
// and 17 override it locally to prove `hold` and the unset default.
beforeEach(() => {
  process.env.PAYOUT_NET_NEGATIVE_POLICY = "carry_forward";
});

describe("M5-CF: catch-up, carry-forward, stuck release, per-associate guard, preview, policy", () => {
  it("1. catch-up: an earlier-month line becomes Eligible late and is paid without re-running its own month", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-01-10");
    await mkLine(tx, a, "2199-01", "500.00");
    const r = await runAsAdmin("2199-02"); // no 2199-01 run ever happened
    expect(r).toEqual({ ok: true, count: 1, blockedAssociateIds: [] });
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2199-02" } });
    expect(payout.totalPayable.toFixed(2)).toBe("500.00");
    const line = await prisma.commissionLedger.findFirstOrThrow({ where: { transactionId: tx } });
    expect(line.payoutId).toBe(payout.id);
    expect(line.payoutMonth).toBe("2199-01"); // earning month is unchanged
  });

  it("2. adjustment catch-up: a delta on an already-Paid line is caught up in a later run", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-01-10");
    await mkLine(tx, a, "2199-01", "500.00");
    expect((await runAsAdmin("2199-01")).ok).toBe(true);
    const first = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2199-01" } });
    expect((await setPayoutStatus(first.id, "Approved")).ok).toBe(true);
    expect((await setPayoutStatus(first.id, "Paid")).ok).toBe(true);
    // A delta line for the same earning month, e.g. a recompute after a rate correction.
    await mkLine(tx, a, "2199-01", "50.00");
    const r = await runAsAdmin("2199-04");
    expect(r).toEqual({ ok: true, count: 1, blockedAssociateIds: [] });
    const adj = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2199-04" } });
    expect(adj.totalPayable.toFixed(2)).toBe("50.00");
    const paidAfter = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: first.id } });
    expect(paidAfter.totalPayable.toFixed(2)).toBe("500.00"); // M5 immutability holds
  });

  it("3. carry-forward: a net-negative earlier month is folded into the next positive month, once", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-05-10");
    await mkLine(tx, a, "2199-05", "-296.00");
    const r1 = await runAsAdmin("2199-05");
    // Under carry_forward, a net<=0 run attaches nothing this month.
    expect(r1).toEqual({ ok: true, count: 0, blockedAssociateIds: [] });
    expect(await prisma.monthlyPayout.count({ where: { associateId: a, payoutMonth: "2199-05" } })).toBe(0);

    await mkLine(tx, a, "2199-06", "1000.00");
    const r2 = await runAsAdmin("2199-06");
    expect(r2).toEqual({ ok: true, count: 1, blockedAssociateIds: [] });
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2199-06" } });
    expect(payout.totalPayable.toFixed(2)).toBe("704.00");
    const lines = await prisma.commissionLedger.findMany({ where: { transactionId: tx } });
    expect(lines.every((l) => l.payoutId === payout.id)).toBe(true);
    expect(await prisma.monthlyPayout.count({ where: { associateId: a, payoutStatus: PayoutStatus.Pending, totalPayable: { lte: 0 } } })).toBe(0);
    await assertConservation(a);
    await assertNeverPaidWhileNegative(a);
  });

  it("4. stuck release: a pre-existing Pending payout at a non-positive total is Cancelled and its lines carried", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-07-10");
    const line = await mkLine(tx, a, "2199-07", "-100.00");
    const stuck = await prisma.monthlyPayout.create({
      data: {
        payoutMonth: "2199-07", associateId: a, seq: 0, associateName: "x", designation: "SalesAssociate",
        personalCommission: "-100.00", totalPayable: "-100.00", payoutStatus: PayoutStatus.Pending,
      },
    });
    await prisma.commissionLedger.update({ where: { id: line.id }, data: { payoutId: stuck.id } });

    await mkLine(tx, a, "2199-08", "1000.00");
    const r = await runAsAdmin("2199-08");
    expect(r).toEqual({ ok: true, count: 1, blockedAssociateIds: [] });

    const stuckAfter = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(stuckAfter.payoutStatus).toBe(PayoutStatus.Cancelled);
    expect(stuckAfter.totalPayable.toFixed(2)).toBe("0.00");
    expect(stuckAfter.remarks).toBe("carried forward to 2199-08");

    const augPayout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2199-08" } });
    expect(augPayout.totalPayable.toFixed(2)).toBe("900.00");
    const audited = vi.mocked(logAudit).mock.calls.map(([x]) => x);
    expect(audited.some((x) => x.action === "payout.carried_forward" && x.entityId === stuck.id)).toBe(true);
    await assertConservation(a);
    await assertNeverPaidWhileNegative(a);
  });

  it("5. still negative: nothing attaches and no payout exists while the carried net stays <= 0", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-09-10");
    await mkLine(tx, a, "2199-09", "-500.00");
    expect(await runAsAdmin("2199-09")).toEqual({ ok: true, count: 0, blockedAssociateIds: [] });
    await mkLine(tx, a, "2199-10", "50.00"); // carried net still -450
    expect(await runAsAdmin("2199-10")).toEqual({ ok: true, count: 0, blockedAssociateIds: [] });
    expect(await prisma.monthlyPayout.count({ where: { associateId: a } })).toBe(0);
    const lines = await prisma.commissionLedger.findMany({ where: { transactionId: tx } });
    expect(lines.every((l) => l.payoutId === null)).toBe(true);
    // These lines would stay unattached forever under carry_forward; clean them up so a
    // later test that switches the policy to `hold` doesn't sweep them in unexpectedly.
    await prisma.commissionLedger.deleteMany({ where: { transactionId: tx } });
  });

  it("6. guard (per associate, rev 5): a blocked associate gets nothing, everyone else still runs", async () => {
    const blocked = await mkAssoc();
    const blockedTx = await mkTransaction(blocked, "2199-11-01");
    await mkLine(blockedTx, blocked, "2199-11", "150.00"); // a genuine new candidate line, at risk of double-payment
    const legacy = await prisma.monthlyPayout.create({
      data: {
        payoutMonth: "2199-11", associateId: blocked, seq: 0, associateName: "x", designation: "SalesAssociate",
        totalPayable: "800.00", payoutStatus: PayoutStatus.Paid,
      },
    }); // no lines linked — as if pre-M5-backfill

    const clean = await mkAssoc();
    const tx = await mkTransaction(clean, "2199-11-10");
    await mkLine(tx, clean, "2199-11", "300.00");

    const r = await runAsAdmin("2199-11");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.count).toBe(1);
    expect(r.blockedAssociateIds).toEqual([blocked]);
    // The blocked associate's new line stays unattached; no second payout for them.
    expect(await prisma.monthlyPayout.count({ where: { associateId: blocked } })).toBe(1); // only the legacy one
    const blockedLine = await prisma.commissionLedger.findFirstOrThrow({ where: { transactionId: blockedTx } });
    expect(blockedLine.payoutId).toBeNull();
    const cleanPayout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: clean, payoutMonth: "2199-11" } });
    expect(cleanPayout.totalPayable.toFixed(2)).toBe("300.00");

    await prisma.commissionLedger.deleteMany({ where: { transactionId: blockedTx } });
    await prisma.monthlyPayout.delete({ where: { id: legacy.id } }); // clear it for later tests in this file
  });

  it("7. no future lines: a line whose earning month is after M is left untouched", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-12-01");
    await mkLine(tx, a, "2200-01", "300.00"); // earning month AFTER the run month
    const r = await runAsAdmin("2199-12");
    expect(r).toEqual({ ok: true, count: 0, blockedAssociateIds: [] });
    const line = await prisma.commissionLedger.findFirstOrThrow({ where: { transactionId: tx } });
    expect(line.payoutId).toBeNull();
  });

  it("10. policy switch: under hold, a non-positive net still attaches Pending and is never approved (today's M5 behaviour)", async () => {
    process.env.PAYOUT_NET_NEGATIVE_POLICY = "hold";
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-01-15");
    await mkLine(tx, a, "2199-13", "-77.00");
    who.session = ADMIN;
    const r = await runPayouts("2199-13");
    expect(r).toEqual({ ok: true, count: 1, blockedAssociateIds: [] });
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2199-13" } });
    expect(payout.totalPayable.toFixed(2)).toBe("-77.00");
    expect(payout.payoutStatus).toBe(PayoutStatus.Pending);
    expect(payout.remarks).toBe("non-positive total");
    expect((await setPayoutStatus(payout.id, "Approved")).ok).toBe(false); // payoutNotPositive
    // hold intentionally leaves a Pending negative payout forever (never approved) —
    // clean it up so it isn't picked up as a stuck payout by a later test's larger month.
    await prisma.commissionLedger.deleteMany({ where: { transactionId: tx } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  it("12. E1 + reconcile (rev 5, 2 associates): one blocked and skipped, one paid; reconciling unblocks the first", async () => {
    const legacyAssoc = await mkAssoc();
    const legacyTx = await mkTransaction(legacyAssoc, "2199-02-01");
    const legacyLine = await mkLine(legacyTx, legacyAssoc, "2199-02", "600.00");
    const legacy = await prisma.monthlyPayout.create({
      data: {
        payoutMonth: "2199-02", associateId: legacyAssoc, seq: 0, associateName: "x", designation: "SalesAssociate",
        totalPayable: "600.00", payoutStatus: PayoutStatus.Paid,
      },
    });

    const cleanAssoc = await mkAssoc();
    const cleanTx = await mkTransaction(cleanAssoc, "2199-03-01");
    await mkLine(cleanTx, cleanAssoc, "2199-03", "400.00");

    // First run: the legacy associate is blocked and gets nothing; the clean one is paid.
    const r1 = await runAsAdmin("2199-03");
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("unreachable");
    expect(r1.count).toBe(1);
    expect(r1.blockedAssociateIds).toEqual([legacyAssoc]);
    expect(await prisma.monthlyPayout.count({ where: { associateId: legacyAssoc, id: { not: legacy.id } } })).toBe(0);
    expect((await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: cleanAssoc } })).totalPayable.toFixed(2)).toBe("400.00");

    who.session = ACCOUNTS;
    expect(await reconcileLegacyPayout(legacy.id, [legacyLine.id], "matches bank statement")).toEqual({ ok: false, code: "forbidden", error: "forbidden" });

    who.session = ADMIN; // Business Admin (isFullAdmin)
    const rec = await reconcileLegacyPayout(legacy.id, [legacyLine.id], "matches bank statement");
    expect(rec).toEqual({ ok: true });
    const linked = await prisma.commissionLedger.findUniqueOrThrow({ where: { id: legacyLine.id } });
    expect(linked.payoutId).toBe(legacy.id);
    const untouched = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(untouched.totalPayable.toFixed(2)).toBe("600.00"); // M5 immutability: unchanged

    // A second reconcile on the same (now-linked) payout is refused.
    expect(await reconcileLegacyPayout(legacy.id, [legacyLine.id], "again")).toEqual({ ok: false, code: "alreadyProcessed", error: "alreadyProcessed" });

    // The formerly-blocked associate now runs normally (nothing new to attach, but not blocked).
    const r2 = await runAsAdmin("2199-03");
    expect(r2).toEqual({ ok: true, count: 0, blockedAssociateIds: [] });
    await assertConservation(legacyAssoc);
    await assertConservation(cleanAssoc);
    await assertNeverPaidWhileNegative(legacyAssoc);
    await assertNeverPaidWhileNegative(cleanAssoc);
  });

  it("15. preview: previewPayoutRun writes nothing and matches what runPayouts then does", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-04-01");
    await mkLine(tx, a, "2199-04", "250.00");
    const before = await prisma.commissionLedger.count();
    const beforePayouts = await prisma.monthlyPayout.count();

    who.session = ADMIN;
    const preview = await previewPayoutRun("2199-04");
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("unreachable");
    const mine = preview.plans.find((p) => p.associateId === a);
    expect(mine).toMatchObject({ newLines: 1, releasedLines: 0, net: "250.00", attach: true, policy: "carry_forward", isLeaver: false });

    expect(await prisma.commissionLedger.count()).toBe(before);
    expect(await prisma.monthlyPayout.count()).toBe(beforePayouts);

    const run = await runAsAdmin("2199-04");
    expect(run).toEqual({ ok: true, count: 1, blockedAssociateIds: [] });
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2199-04" } });
    expect(payout.totalPayable.toFixed(2)).toBe("250.00");
  });

  it("17. default policy: with the env var unset, a non-positive net is held, not carried", async () => {
    delete process.env.PAYOUT_NET_NEGATIVE_POLICY;
    vi.resetModules();
    const { runPayouts: runPayoutsDefault } = await import("./actions");
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-01-06");
    await mkLine(tx, a, "2199-14", "-10.00");
    who.session = ADMIN;
    const r = await runPayoutsDefault("2199-14");
    expect(r).toEqual({ ok: true, count: 1, blockedAssociateIds: [] }); // hold attaches (unlike carry_forward's count 0)
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2199-14" } });
    expect(payout.remarks).toBe("non-positive total");
    vi.resetModules();
    await prisma.commissionLedger.deleteMany({ where: { transactionId: tx } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });

  it("18. leaver: a Terminated associate's negative carry is never netted or zeroed, and stays flagged", async () => {
    const a = await mkAssoc("Terminated");
    const tx = await mkTransaction(a, "2199-01-08");
    await mkLine(tx, a, "2199-15", "-200.00");
    who.session = ADMIN;
    expect(await runPayouts("2199-15")).toEqual({ ok: true, count: 0, blockedAssociateIds: [] }); // carry_forward: nothing attached
    // Runs again next month: still nothing to attach, no write-off, no payout ever created.
    expect(await runPayouts("2199-16")).toEqual({ ok: true, count: 0, blockedAssociateIds: [] });
    expect(await prisma.monthlyPayout.count({ where: { associateId: a } })).toBe(0);
    const line = await prisma.commissionLedger.findFirstOrThrow({ where: { transactionId: tx } });
    expect(line.payoutId).toBeNull();
    expect(line.amount.toFixed(2)).toBe("-200.00"); // never zeroed
    const preview = await previewPayoutRun("2199-16");
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("unreachable");
    const mine = preview.plans.find((p) => p.associateId === a);
    expect(mine?.attach).toBe(false); // admin-page flag ("recover manually") is FullStack's UI on top of this
    expect(mine?.isLeaver).toBe(true);
    await assertConservation(a);
    await assertNeverPaidWhileNegative(a);
  });

  it("13. received with CF (R-6): a Paid settlement payout makes ALL its lines (carried-in included) count as received", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2199-01-17");
    await mkLine(tx, a, "2199-17", "-296.00"); // Sept-equivalent: carried, no payout yet
    const r0 = await runAsAdmin("2199-17");
    if (!r0.ok) throw new Error("unreachable");
    expect(r0.count).toBe(0);
    await mkLine(tx, a, "2199-18", "1000.00"); // Oct-equivalent: folds the carried line in
    const run = await runAsAdmin("2199-18");
    expect(run.ok).toBe(true);
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2199-18" } });
    expect(payout.totalPayable.toFixed(2)).toBe("704.00");

    const linesWithPayout = () => prisma.commissionLedger.findMany({
      where: { transactionId: tx },
      select: { associateId: true, lineType: true, status: true, amount: true, payout: { select: { payoutStatus: true } } },
    });
    const { summariseMyShare } = await import("@/lib/my-share");
    const txnShape = { closingAssociateId: a, directUplineId: null, secondUplineId: null };

    // Before Paid: share includes both lines, received is 0 for either.
    const before = summariseMyShare(await linesWithPayout(), a, txnShape);
    expect(before.share.toFixed(2)).toBe("704.00");
    expect(before.received.toFixed(2)).toBe("0.00");

    expect((await setPayoutStatus(payout.id, "Approved")).ok).toBe(true);
    expect((await setPayoutStatus(payout.id, "Paid")).ok).toBe(true);

    // After Paid: BOTH lines count as received — the carried-in Sept-equivalent
    // line included, not just the Oct-equivalent one — because "received" is
    // derived from payoutId -> payout.payoutStatus, not from which month a line
    // was earned in.
    const after = summariseMyShare(await linesWithPayout(), a, txnShape);
    expect(after.received.toFixed(2)).toBe("704.00");
    expect(after.balance.toFixed(2)).toBe("0.00");
    const lines = await linesWithPayout();
    expect(lines.every((l) => l.payout?.payoutStatus === "Paid")).toBe(true);
  });
});
