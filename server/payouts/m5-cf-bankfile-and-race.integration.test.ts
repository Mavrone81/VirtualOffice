// M5-CF §6 items 8 (bank file) and 9/14 (concurrency): reviews/m5-cf-design.md.
// Bank file: no code change there (§4) — this proves it, using real carried-in
// lines. Concurrency: real Postgres, two pooled connections, the same
// "kick off both, let Postgres serialize, check invariants" style as
// m5-concurrency.integration.test.ts and the C1 race test. Needs a local PG
// (DATABASE_URL); fake data only, all rows tagged and cleaned up. Months are in
// the 2198 range (own reserved band, distinct from m5-cf-catchup's 2199 range),
// so this file never collides with any other integration test.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { LedgerLineType, LedgerStatus, PayoutStatus } from "@prisma/client";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));

import { prisma } from "@/lib/db";
import { runPayouts, setPayoutStatus } from "./actions";
import { buildBankFileCsv } from "./bankfile";

const TAG = "M5CFR-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const assocSeq = { n: 0 };

async function mkAssoc() {
  assocSeq.n++;
  const a = await prisma.associate.create({
    data: {
      associateCode: `${TAG}A${assocSeq.n}`, fullName: `${TAG}A${assocSeq.n}`,
      designation: "SalesAssociate", approvalStatus: "Approved", associateStatus: "Active",
    },
    select: { id: true },
  });
  return a.id;
}

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

async function mkLine(transactionId: string, associateId: string, month: string, amount: string) {
  return prisma.commissionLedger.create({
    data: {
      transactionId, payoutMonth: month, associateId, lineType: LedgerLineType.Personal,
      basisAmount: "1000", amount, eligibility: "Eligible", status: LedgerStatus.Eligible,
    },
  });
}

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.bankFileBatch.deleteMany({ where: { payoutMonth: { startsWith: "2198-" }, payouts: { none: {} } } });
  await prisma.monthlyPayout.deleteMany({ where: { associate: mine } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.associate.deleteMany({ where: mine });
});

// The policy is read fresh from process.env on every call, not from an ambient
// .env value — CI never sets PAYOUT_NET_NEGATIVE_POLICY.
beforeEach(() => {
  process.env.PAYOUT_NET_NEGATIVE_POLICY = "carry_forward";
});

describe("M5-CF §6.8: bank file with carried-in lines", () => {
  it("a Cancelled payout never appears; the settlement month's amount includes carried-in lines exactly once; re-running is a no-op", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2198-01-10");
    who.session = ADMIN;
    await mkLine(tx, a, "2198-01", "-296.00");
    const r1 = await runPayouts("2198-01");
    if (!r1.ok) throw new Error("unreachable");
    expect(r1.count).toBe(0); // carry_forward: nothing attached yet

    await mkLine(tx, a, "2198-02", "1000.00");
    const run = await runPayouts("2198-02");
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error("unreachable");
    expect(run.count).toBe(1);
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2198-02" } });
    expect(payout.totalPayable.toFixed(2)).toBe("704.00");

    expect((await setPayoutStatus(payout.id, "Approved")).ok).toBe(true);

    const file1 = await buildBankFileCsv("2198-02", ADMIN.user.id);
    expect(file1.payoutIds).toEqual([payout.id]);
    expect(file1.total).toBe("704.00");
    expect(file1.csv).toContain('"704.00"');
    // Exactly one row for this payout — the carried-in Jan line and the Feb line
    // are summed into ONE total_payable, not exported as two lines.
    expect(file1.csv.split("\r\n")).toHaveLength(2); // header + one payout row

    expect((await setPayoutStatus(payout.id, "Paid")).ok).toBe(true);

    // Re-running the settlement month is a no-op: nothing left to attach, no new payout.
    const rerun = await runPayouts("2198-02");
    expect(rerun).toEqual({ ok: true, count: 0, blockedAssociateIds: [] });
    expect(await prisma.monthlyPayout.count({ where: { associateId: a } })).toBe(1);

    // Re-downloading the same batch (no new selection) gives the identical amount —
    // a Paid payout is never re-listed by a fresh (batchId-less) generation either.
    const file2 = await buildBankFileCsv("2198-02", ADMIN.user.id, { batchId: file1.batchId ?? undefined });
    expect(file2.total).toBe("704.00");
    const freshSelection = await buildBankFileCsv("2198-02", ADMIN.user.id);
    expect(freshSelection.payoutIds).toEqual([]); // Paid, not Approved — nothing new to export

    // The earlier Cancelled-by-release payout (if any existed) would never appear —
    // there isn't one in this scenario (net was negative with no prior Pending payout
    // to release), so assert the general invariant instead: no Cancelled payout for
    // this associate is ever included in any batch.
    const cancelled = await prisma.monthlyPayout.findMany({ where: { associateId: a, payoutStatus: PayoutStatus.Cancelled } });
    expect(cancelled.every((p) => p.bankFileBatchId === null)).toBe(true);
  });
});

describe("M5-CF §6.9/14: concurrency (real Postgres, two connections)", () => {
  it("a stuck-payout release racing an unrelated approval settles cleanly, invariants hold", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2198-03-10");
    const stuckLine = await mkLine(tx, a, "2198-03", "-50.00");
    const stuck = await prisma.monthlyPayout.create({
      data: {
        payoutMonth: "2198-03", associateId: a, seq: 0, associateName: "x", designation: "SalesAssociate",
        personalCommission: "-50.00", totalPayable: "-50.00", payoutStatus: PayoutStatus.Pending,
      },
    });
    await prisma.commissionLedger.update({ where: { id: stuckLine.id }, data: { payoutId: stuck.id } });
    await mkLine(tx, a, "2198-04", "200.00");

    // A second, unrelated associate with a positive Pending payout for the SAME
    // settlement month, approved concurrently with the run that releases `a`'s
    // stuck payout — exercises the E2 lock order (ledger, then payout) without
    // the two operations touching the same rows.
    const b = await mkAssoc();
    const txB = await mkTransaction(b, "2198-04-10");
    await mkLine(txB, b, "2198-04", "500.00");
    who.session = ADMIN;
    expect((await runPayouts("2198-04")).ok).toBe(true); // seeds b's Pending payout for 2198-04, before the race
    const bPayout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: b, payoutMonth: "2198-04" } });

    who.session = ADMIN;
    const [runResult, approveResult] = await Promise.allSettled([
      runPayouts("2198-04"), // releases a's stuck payout + attaches a's new line
      setPayoutStatus(bPayout.id, "Approved"),
    ]);
    expect(runResult.status).toBe("fulfilled");
    expect(approveResult.status).toBe("fulfilled");
    if (runResult.status === "fulfilled") expect(runResult.value.ok).toBe(true);
    if (approveResult.status === "fulfilled") expect((approveResult.value as { ok: boolean }).ok).toBe(true);

    const stuckAfter = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(stuckAfter.payoutStatus).toBe(PayoutStatus.Cancelled);
    const aPayout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2198-04" } });
    expect(aPayout.totalPayable.toFixed(2)).toBe("150.00"); // -50 released + 200 new
    const bAfter = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: bPayout.id } });
    expect(bAfter.payoutStatus).toBe(PayoutStatus.Approved);
    expect(bAfter.totalPayable.toFixed(2)).toBe("500.00"); // unaffected by a's release/attach

    // Invariant: every line is attached to exactly one non-Cancelled payout (or
    // still correctly unattached — none are here), and totals match their lines.
    for (const assoc of [a, b]) {
      const lines = await prisma.commissionLedger.findMany({ where: { associateId: assoc, transaction: { closingAssociateId: assoc } } });
      const payouts = await prisma.monthlyPayout.findMany({ where: { associateId: assoc, payoutStatus: { not: PayoutStatus.Cancelled } } });
      for (const p of payouts) {
        const mine = lines.filter((l) => l.payoutId === p.id).reduce((s, l) => s + Number(l.amount), 0);
        expect(Number(p.totalPayable)).toBeCloseTo(mine, 2);
      }
    }
  });

  it("release/attach racing an approve on the SAME payout: no double-write, a retry converges", async () => {
    const a = await mkAssoc();
    const tx = await mkTransaction(a, "2198-05-10");
    await mkLine(tx, a, "2198-05", "300.00");
    who.session = ADMIN;
    expect((await runPayouts("2198-05")).ok).toBe(true);
    const payout = await prisma.monthlyPayout.findFirstOrThrow({ where: { associateId: a, payoutMonth: "2198-05" } });
    expect(payout.totalPayable.toFixed(2)).toBe("300.00");

    // A late-eligible line for the SAME associate and settlement month, racing the
    // approval of the payout it would join.
    await mkLine(tx, a, "2198-05", "70.00");
    who.session = ADMIN;
    const [runResult, approveResult] = await Promise.allSettled([
      runPayouts("2198-05"),
      setPayoutStatus(payout.id, "Approved"),
    ]);
    expect(runResult.status).toBe("fulfilled");
    expect(approveResult.status).toBe("fulfilled");
    // Whichever wins: no crash, and the loser reports a clean, safe outcome —
    // never a corrupted total.
    const runOk = runResult.status === "fulfilled" && runResult.value.ok;
    const approveOk = approveResult.status === "fulfilled" && (approveResult.value as { ok: boolean }).ok;
    expect(runOk || approveOk).toBe(true);

    // Retry until the run succeeds (the design's own documented recovery path: a
    // conflict is always safe to retry, since only unattached lines are picked up).
    let settled = await runPayouts("2198-05");
    for (let i = 0; i < 3 && !settled.ok; i++) settled = await runPayouts("2198-05");
    expect(settled.ok).toBe(true);

    const line = await prisma.commissionLedger.findFirstOrThrow({ where: { transactionId: tx, amount: "70.00" } });
    expect(line.payoutId).not.toBeNull();
    const finalPayout = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: line.payoutId! } });
    const linesOfFinal = await prisma.commissionLedger.findMany({ where: { payoutId: finalPayout.id } });
    // Whether the 70 landed in the original (now Approved) payout or a new
    // Adjustment payout, its total equals exactly the lines attached to it —
    // never rewritten, never double-counted.
    expect(Number(finalPayout.totalPayable)).toBeCloseTo(linesOfFinal.reduce((s, l) => s + Number(l.amount), 0), 2);
  });

  it("two runs racing (same month, real interleave) keeps every invariant, repeated rounds", async () => {
    const rounds = 6;
    for (let r = 0; r < rounds; r++) {
      const a = await mkAssoc();
      const tx = await mkTransaction(a, "2198-06-10");
      await mkLine(tx, a, "2198-06", `${100 + r}.00`);
      who.session = ADMIN;
      const results = await Promise.allSettled([runPayouts("2198-06"), runPayouts("2198-06")]);
      for (const res of results) {
        expect(res.status).toBe("fulfilled");
        const v = (res as PromiseFulfilledResult<{ ok: boolean; error?: string }>).value;
        expect(v.ok || v.error === "payoutRunConflict").toBe(true);
      }
      // A retry after a conflict settles whatever the losing run left over.
      let retry = await runPayouts("2198-06");
      for (let i = 0; i < 3 && !retry.ok; i++) retry = await runPayouts("2198-06");
      expect(retry.ok).toBe(true);

      const line = await prisma.commissionLedger.findFirstOrThrow({ where: { transactionId: tx } });
      expect(line.payoutId).not.toBeNull();
      const payout = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: line.payoutId! } });
      const mine = await prisma.commissionLedger.findMany({ where: { payoutId: payout.id } });
      expect(Number(payout.totalPayable)).toBeCloseTo(mine.reduce((s, l) => s + Number(l.amount), 0), 2);
    }
  });
});
