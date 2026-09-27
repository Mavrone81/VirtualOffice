// M5-CF fix-round regression tests, covering the money review (Architect C1),
// the code review (DevLead C1/C2/C5) and DevSecOps's probe
// (reviews/m5-cf-probe-d33da96.integration.test.ts, cases P1/P2/P2b/P3), against
// database/m5-cf-payout-runs @ d33da96 (pre-fix) and the fixed head. Needs a
// local PG (DATABASE_URL); fake data only, all rows tagged and cleaned up.
// Months are in the 2197 range, its own reserved band.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { LedgerLineType, LedgerStatus, PayoutStatus } from "@prisma/client";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

// DevSecOps's P3 probe: a hook right after buildCatchupPlan runs, to land a
// concurrent recompute inside the window between the pre-lock plan and the lock.
const hook: { afterPlan: null | (() => Promise<void>) } = { afterPlan: null };
vi.mock("@/server/payouts/catchup", async (orig) => {
  const real = await orig<typeof import("@/server/payouts/catchup")>();
  return {
    ...real,
    buildCatchupPlan: async (...a: Parameters<typeof real.buildCatchupPlan>) => {
      const p = await real.buildCatchupPlan(...a);
      if (hook.afterPlan) await hook.afterPlan();
      return p;
    },
  };
});

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { runPayouts, previewPayoutRun, reconcileLegacyPayout, setPayoutStatus } from "./actions";

const TAG = "M5CFFIX-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const ACCOUNTS = { user: { associateId: null, id: "22222222-2222-2222-2222-222222222222", role: "Accounts" } };
const assocSeq = { n: 0 };

async function mkAssoc() {
  assocSeq.n++;
  const a = await prisma.associate.create({
    data: { associateCode: `${TAG}A${assocSeq.n}`, fullName: `${TAG}A${assocSeq.n}`, designation: "SalesAssociate", approvalStatus: "Approved", associateStatus: "Active" },
    select: { id: true },
  });
  return a.id;
}

async function mkTransaction(associateId: string, salesDate: string) {
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date(salesDate), clientName: TAG + "Client", saleAmount: "1000", paymentPlan: "FullPayment", closingAssociateId: associateId, status: "QuotationApproved", closedAt: new Date() },
    select: { id: true },
  });
  const tx = await prisma.salesTransaction.create({
    data: {
      transactionCode: `${TAG}TXN-${sub.id.slice(0, 8)}`, submissionId: sub.id, salesDate: new Date(salesDate),
      clientName: TAG + "Client", saleAmount: "1000", paymentPlan: "FullPayment", closingAssociateId: associateId, commissionEligibility: "Eligible",
    },
    select: { id: true },
  });
  return tx.id;
}

async function mkLine(transactionId: string, associateId: string, month: string, amount: string, status: LedgerStatus = LedgerStatus.Eligible) {
  return prisma.commissionLedger.create({
    data: { transactionId, payoutMonth: month, associateId, lineType: LedgerLineType.Personal, basisAmount: "1000", amount, eligibility: "Eligible", status },
  });
}

const mkPayout = (associateId: string, month: string, total: string, status: PayoutStatus) =>
  prisma.monthlyPayout.create({ data: { payoutMonth: month, associateId, seq: 0, associateName: "x", designation: "SalesAssociate", totalPayable: total, payoutStatus: status } });

/** Architect §11: Σ non-Cancelled payouts + Σ unattached Eligible = Σ Eligible lines, per associate. */
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
  // If the associate's already-settled money plus what's still waiting is negative
  // overall, nothing should have been approved/paid out of it yet.
  expect(approvedOrPaidTotal + unattachedNet).toBeGreaterThanOrEqual(0);
}

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.monthlyPayout.deleteMany({ where: { associate: mine } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.associate.deleteMany({ where: mine });
});

beforeEach(() => {
  process.env.PAYOUT_NET_NEGATIVE_POLICY = "carry_forward";
  hook.afterPlan = null;
});

describe("Architect C1: an existing Pending settlement payout must be released when the net turns negative", () => {
  it("run 1 attaches +100 (Pending); a -300 line appears; run 2 (net -200) must release the +100, not leave it payable", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2197-01-10");
    await mkLine(tx, a, "2197-01", "100.00");
    who.session = ADMIN;
    const r1 = await runPayouts("2197-01");
    if (!r1.ok) throw new Error("unreachable");
    expect(r1.count).toBe(1);
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2197-01" } });
    expect(payout.totalPayable.toFixed(2)).toBe("100.00");
    expect(payout.payoutStatus).toBe(PayoutStatus.Pending);

    // A clawback / negative recompute for the SAME settlement month.
    await mkLine(tx, a, "2197-01", "-300.00");
    const r2 = await runPayouts("2197-01");
    if (!r2.ok) throw new Error("unreachable");

    const payoutAfter = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(payoutAfter.payoutStatus).toBe(PayoutStatus.Cancelled);
    expect(payoutAfter.totalPayable.toFixed(2)).toBe("0.00");
    expect(payoutAfter.remarks).toBe("carried forward (net <= 0)");

    // It can no longer be approved/paid — it's not Pending any more.
    expect((await setPayoutStatus(payout.id, "Approved")).ok).toBe(false);

    // Nothing is left payable for this associate: no Approved/Paid payout, and
    // the associate is not paid while their net position is negative.
    expect(await prisma.monthlyPayout.count({ where: { associateId: a, payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] } } })).toBe(0);
    await assertConservation(a);
    await assertNeverPaidWhileNegative(a);

    const audited = vi.mocked(logAudit).mock.calls.map(([x]) => x);
    expect(audited.some((x) => x.action === "payout.carried_forward" && x.entityId === payout.id)).toBe(true);
    // §3: the policy name is recorded on the run 2 audit (the one that released it).
    const runAudits = audited.filter((x) => x.action === "payouts.run" && (x.after as { month?: string }).month === "2197-01");
    expect((runAudits.at(-1)?.after as { policy?: string } | undefined)?.policy).toBe("carry_forward");

    // The released lines are unattached again (still net-negative) — clean them
    // up so a later test with a more permissive policy (hold) doesn't sweep
    // them into an unrelated run at a later month.
    await prisma.commissionLedger.deleteMany({ where: { transactionId: tx } });
  });
});

describe("DevLead/DevSecOps C1 (P1): reconcileLegacyPayout must not link another associate's lines", () => {
  it("refuses when the given line ids don't all belong to the payout's own associate", async () => {
    const x = await mkAssoc();
    const y = await mkAssoc();
    const legacy = await mkPayout(x, "2197-06", "100.00", PayoutStatus.Paid);
    const ty = await mkTransaction(y, "2197-06-01");
    const yLine = await mkLine(ty, y, "2197-06", "100.00");

    who.session = ADMIN;
    const r = await reconcileLegacyPayout(legacy.id, [yLine.id], "wrong associate");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("payoutRunConflict"); // the candidate filter excludes it -> count mismatch

    const after = await prisma.commissionLedger.findUniqueOrThrow({ where: { id: yLine.id } });
    expect(after.payoutId).toBeNull(); // y's line was never linked to x's payout
    // Never reconciled by design — clean it up so it doesn't block a later
    // test/file's run at any month >= 2197-06.
    await prisma.monthlyPayout.delete({ where: { id: legacy.id } });
  });
});

describe("DevLead/DevSecOps C2 (P2): the re-typed difference must equal the actual gap and carry a reason", () => {
  it("refuses a wrong amount with an empty reason", async () => {
    const x = await mkAssoc();
    const legacy = await mkPayout(x, "2197-07", "100.00", PayoutStatus.Paid);
    const tx = await mkTransaction(x, "2197-07-01");
    const l = await mkLine(tx, x, "2197-07", "60.00"); // gap = 60 - 100 = -40
    who.session = ADMIN;
    const r = await reconcileLegacyPayout(legacy.id, [l.id], "probe", { amount: "999.99", reason: "" });
    expect(r).toMatchObject({ ok: false, code: "legacyDifferenceRequired" });
    expect((await prisma.commissionLedger.findUniqueOrThrow({ where: { id: l.id } })).payoutId).toBeNull();
    await prisma.monthlyPayout.delete({ where: { id: legacy.id } }); // never reconciled by design
  });

  it("refuses a wrong amount even with a reason (mismatch, not just presence)", async () => {
    const x = await mkAssoc();
    const legacy = await mkPayout(x, "2197-08", "100.00", PayoutStatus.Paid);
    const tx = await mkTransaction(x, "2197-08-01");
    const l = await mkLine(tx, x, "2197-08", "60.00"); // gap = -40, not -1
    who.session = ADMIN;
    const r = await reconcileLegacyPayout(legacy.id, [l.id], "probe", { amount: "-1.00", reason: "close enough" });
    expect(r).toMatchObject({ ok: false, code: "legacyDifferenceMismatch" });
    await prisma.monthlyPayout.delete({ where: { id: legacy.id } }); // never reconciled by design
  });

  it("(DevLead) a non-numeric re-typed amount is a clean mismatch, never a raw 500", async () => {
    const x = await mkAssoc();
    const legacy = await mkPayout(x, "2197-08", "100.00", PayoutStatus.Paid);
    const tx = await mkTransaction(x, "2197-08-02");
    const l = await mkLine(tx, x, "2197-08", "60.00");
    who.session = ADMIN;
    await expect(
      reconcileLegacyPayout(legacy.id, [l.id], "probe", { amount: "not-a-number", reason: "typo" }),
    ).resolves.toMatchObject({ ok: false, code: "legacyDifferenceMismatch" });
    await prisma.monthlyPayout.delete({ where: { id: legacy.id } });
  });

  it("accepts the correct re-typed gap with a reason", async () => {
    const x = await mkAssoc();
    const legacy = await mkPayout(x, "2197-09", "100.00", PayoutStatus.Paid);
    const tx = await mkTransaction(x, "2197-09-01");
    const l = await mkLine(tx, x, "2197-09", "60.00"); // gap = 60 - 100 = -40.00
    who.session = ADMIN;
    const r = await reconcileLegacyPayout(legacy.id, [l.id], "bank shows only 60 for this batch", { amount: "-40.00", reason: "reconciled against bank statement" });
    expect(r).toEqual({ ok: true });
    expect((await prisma.commissionLedger.findUniqueOrThrow({ where: { id: l.id } })).payoutId).toBe(legacy.id);
  });

  it("(P2b) refuses a Cancelled-status line as a candidate (defence in depth)", async () => {
    const x = await mkAssoc();
    const legacy = await mkPayout(x, "2197-10", "50.00", PayoutStatus.Paid);
    const tx = await mkTransaction(x, "2197-10-01");
    const l = await mkLine(tx, x, "2197-10", "50.00", LedgerStatus.Cancelled);
    who.session = ADMIN;
    const r = await reconcileLegacyPayout(legacy.id, [l.id], "probe");
    expect(r).toMatchObject({ ok: false, code: "payoutRunConflict" });
    expect((await prisma.commissionLedger.findUniqueOrThrow({ where: { id: l.id } })).payoutId).toBeNull();
    await prisma.monthlyPayout.delete({ where: { id: legacy.id } }); // never reconciled by design
  });
});

describe("DevLead C5 / DevSecOps P3: a stuck payout that turns positive under the lock is not wrongly released", () => {
  it("re-reads fresh before releasing; a payout that became positive between the plan and the lock conflicts instead", async () => {
    const x = await mkAssoc();
    const tx = await mkTransaction(x, "2197-11-01");
    const stuck = await mkPayout(x, "2197-11", "-50.00", PayoutStatus.Pending);
    const neg = await mkLine(tx, x, "2197-11", "-50.00");
    await prisma.commissionLedger.update({ where: { id: neg.id }, data: { payoutId: stuck.id } });

    // Between the pre-lock plan read and the lock, a concurrent recompute commits
    // that turns this "stuck" payout positive.
    hook.afterPlan = async () => {
      const pos = await mkLine(tx, x, "2197-11", "500.00");
      await prisma.commissionLedger.update({ where: { id: pos.id }, data: { payoutId: stuck.id } });
      await prisma.monthlyPayout.update({ where: { id: stuck.id }, data: { totalPayable: "450.00" } });
    };
    const r = await runPayouts("2197-12");
    expect(r).toEqual({ ok: false, code: "payoutRunConflict", error: "payoutRunConflict" });

    // The payout was NOT wrongly cancelled — it's still Pending, still holding
    // its (now positive) lines.
    const after = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(after.payoutStatus).toBe(PayoutStatus.Pending);
    expect(after.totalPayable.toFixed(2)).toBe("450.00");
    const lines = await prisma.commissionLedger.findMany({ where: { transactionId: tx } });
    expect(lines.every((l) => l.payoutId === stuck.id)).toBe(true);

    // A retry (no concurrent interference this time) settles cleanly, and the
    // now-legitimately-positive payout is left untouched by the catch-up run.
    const retry = await runPayouts("2197-12");
    expect(retry.ok).toBe(true);
    const stillThere = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(stillThere.payoutStatus).toBe(PayoutStatus.Pending);
    expect(stillThere.totalPayable.toFixed(2)).toBe("450.00");
  });
});

describe("DevSecOps I3: the suite must not depend on an ambient PAYOUT_NET_NEGATIVE_POLICY", () => {
  it("with the env var unset, runPayouts behaves as hold (the schema default)", async () => {
    delete process.env.PAYOUT_NET_NEGATIVE_POLICY;
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2197-13-01".replace("13", "01"));
    await mkLine(tx, a, "2197-13", "-5.00");
    who.session = ADMIN;
    const r = await runPayouts("2197-13");
    if (!r.ok) throw new Error("unreachable");
    expect(r.count).toBe(1); // hold attaches (unlike carry_forward's 0)
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2197-13" } });
    expect(payout.remarks).toBe("non-positive total");
    await prisma.commissionLedger.deleteMany({ where: { transactionId: tx } });
    await prisma.monthlyPayout.delete({ where: { id: payout.id } });
  });
});

describe("DevSecOps I5: an unimplemented policy is a clean error, not a raw 500", () => {
  it("runPayouts", async () => {
    process.env.PAYOUT_NET_NEGATIVE_POLICY = "recover";
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2197-14-01".replace("14", "02"));
    await mkLine(tx, a, "2197-14", "-1.00");
    who.session = ADMIN;
    await expect(runPayouts("2197-14")).resolves.toEqual({ ok: false, code: "payoutPolicyNotImplemented", error: "payoutPolicyNotImplemented" });
    await prisma.commissionLedger.deleteMany({ where: { transactionId: tx } });
  });

  it("previewPayoutRun", async () => {
    process.env.PAYOUT_NET_NEGATIVE_POLICY = "company_absorbs";
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2197-15-01".replace("15", "03"));
    await mkLine(tx, a, "2197-15", "-1.00");
    who.session = ADMIN;
    await expect(previewPayoutRun("2197-15")).resolves.toEqual({ ok: false, code: "payoutPolicyNotImplemented", error: "payoutPolicyNotImplemented" });
    await prisma.commissionLedger.deleteMany({ where: { transactionId: tx } });
  });
});
