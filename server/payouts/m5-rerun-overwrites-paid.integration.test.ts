// M5 runtime confirmation (T1(L)-DevLead, 2026-09-25): re-running runPayouts for a
// month must not rewrite a payout that is already Approved/Paid. On 0f89098 the
// upsert in runPayouts updates totals regardless of payoutStatus, so a late
// Eligible line (second invoice paid in the same payout month) silently changes
// the amount on a payout that has already been paid out. Needs a local PG
// (DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";
import { markInvoicePaid } from "@/server/invoices/actions";
import { runPayouts, setPayoutStatus } from "./actions";
import { buildBankFileCsv } from "./bankfile";
import { runCommission } from "@/server/commission/run";
import { planPayoutBackfill } from "./backfill-plan";

const TAG = "M5RERUN-";
const SALE_DATE = "2099-03-10";
const MONTH = "2099-03";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", sdId = "", smId = "", closerId = "", paidPayoutId = "";

async function mkAssoc(code: string, designation: string, direct: string | null, second: string | null) {
  const a = await prisma.associate.create({
    data: {
      associateCode: TAG + code, fullName: code, designation: designation as never,
      directUplineId: direct, secondUplineId: second,
      approvalStatus: "Approved" as never, associateStatus: "Active" as never,
    },
    select: { id: true },
  });
  return a.id;
}

/** Submit → approve → close → mark the invoice Paid: leaves Eligible ledger lines in MONTH. */
async function paidSale(amount: number) {
  who.session = { user: { associateId: closerId, id: "sess-closer" } };
  expect((await submitSale({
    salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Full Payment",
    lines: [{ productId, lineSaleAmount: amount, comCodeIds: [] }],
  } as never)).ok).toBe(true);
  const sub = await prisma.salesSubmission.findFirstOrThrow({
    where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true },
  });
  who.session = ADMIN;
  expect((await approveSubmissionSplit(sub.id)).ok).toBe(true); // closure needs flow A signed off
  expect((await adminApproveSplit(sub.id)).ok).toBe(true);
  expect((await approveQuotation(sub.id)).ok).toBe(true);
  await prisma.submissionDocument.create({
    data: { submissionId: sub.id, kind: "Signed", fileKey: TAG + "signed.pdf", fileName: "signed.pdf" },
  });
  expect((await closeSale(sub.id)).ok).toBe(true);
  const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: sub.id } });
  const inv = await prisma.invoice.findFirstOrThrow({ where: { transactionId: tx.id } });
  expect((await markInvoicePaid(inv.id, { method: "Bank", reference: TAG + amount })).ok).toBe(true);
}

beforeAll(async () => {
  companyId = (await prisma.company.create({
    data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true },
  })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "M5 Test", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date(SALE_DATE),
    },
    select: { id: true },
  })).id;
  await prisma.commissionStructureVersion.create({
    data: {
      productCode: TAG + "P1", productId, effectiveDate: new Date("2099-01-01"),
      rateSnapshot: {
        commissionType: "Percentage", closingCommPct: "10", closingCommFixed: null,
        companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
        isExternal: false, externalCompanyRetainedPct: null,
      } as never,
    },
  });
  sdId = await mkAssoc("SD", "SalesDirector", null, null);
  smId = await mkAssoc("SM", "SalesManager", sdId, null);
  closerId = await mkAssoc("CL", "SalesAssociate", smId, sdId);
});

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.monthlyPayout.deleteMany({ where: { associate: mine } });
  await prisma.bankFileBatch.deleteMany({ where: { payoutMonth: MONTH, payouts: { none: {} } } });
  await prisma.invoice.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.submissionDocument.deleteMany({ where: { fileKey: { startsWith: TAG } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: mine });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

describe("M5: runPayouts re-run vs an already-Paid payout", () => {
  it("does not change the amounts on a payout that is already Paid", async () => {
    await paidSale(10000); // closer net 800
    who.session = ADMIN;
    expect((await runPayouts(MONTH)).ok).toBe(true);
    const p = await prisma.monthlyPayout.findUniqueOrThrow({
      where: { associateId_payoutMonth_seq: { associateId: closerId, payoutMonth: MONTH, seq: 0 } },
    });
    expect(Number(p.totalPayable)).toBeCloseTo(800, 2);
    paidPayoutId = p.id;
    expect((await setPayoutStatus(p.id, "Approved")).ok).toBe(true);
    expect((await setPayoutStatus(p.id, "Paid")).ok).toBe(true);

    // A second invoice for the same payout month is paid after the payout went out,
    // and accounts re-run the month.
    await paidSale(5000); // closer net +400
    who.session = ADMIN;
    expect((await runPayouts(MONTH)).ok).toBe(true);

    const after = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.payoutStatus).toBe("Paid");
    // Expected: the paid record is immutable (late lines belong in a new/adjustment payout).
    expect(Number(after.totalPayable)).toBeCloseTo(800, 2);
    expect(Number(after.personalCommission)).toBeCloseTo(Number(p.personalCommission), 2);

    // The late 400 goes into a separate Pending adjustment payout for the month.
    const adj = await prisma.monthlyPayout.findUnique({
      where: { associateId_payoutMonth_seq: { associateId: closerId, payoutMonth: MONTH, seq: 1 } },
    });
    expect(adj?.kind).toBe("Adjustment");
    expect(adj?.payoutStatus).toBe("Pending");
    expect(Number(adj?.totalPayable)).toBeCloseTo(400, 2);

    // Re-running again is a no-op: nothing new to settle, nothing rewritten.
    expect((await runPayouts(MONTH)).ok).toBe(true);
    const all = await prisma.monthlyPayout.findMany({ where: { associateId: closerId, payoutMonth: MONTH }, orderBy: { seq: "asc" } });
    expect(all.map((x) => Number(x.totalPayable))).toEqual([800, 400]);
  });

  it("audit for a re-run records each payout written, with its amounts", () => {
    // On 0f89098 the only entry is payouts.run { month, count }. Required: one entry per
    // payout written, with amounts (before/after for an updated Pending payout).
    const calls = vi.mocked(logAudit).mock.calls.map(([a]) => a);
    const adj = calls.filter((a) => a.action === "payout.adjustment_created");
    expect(adj).toHaveLength(1);
    expect(adj[0].after).toMatchObject({ total: "400.00", seq: 1 });
    expect(calls.filter((a) => a.action === "payout.updated").every((a) => a.before !== undefined && a.after !== undefined)).toBe(true);
    // Still-Pending payouts (the SM/SD overrides) legitimately absorb the late lines;
    // the Paid payout is never written, so it has no update entry.
    expect(calls.filter((a) => a.action === "payout.updated" && a.entityId === paidPayoutId)).toHaveLength(0);
  });

  it("a bank file regenerated after the re-run does not pay an already-Paid payout again", async () => {
    // State from the first case: the payout was Paid at 800, then the re-run rewrote it to 1200.
    // bankfile.ts selects Approved AND Paid payouts, so regenerating the month's file
    // lists the full 1200 for an associate who has already received 800.
    const { csv } = await buildBankFileCsv(MONTH, ADMIN.user.id);
    const row = csv.split("\r\n").find((r) => r.startsWith(`"${TAG}CL"`));
    expect(row ?? "(no row)").not.toContain("1200.00");
    expect(row).toBeUndefined(); // Paid payouts are settled; they must not be re-listed for payment
  });

  it("exports each Approved payout exactly once, positive totals only, and can re-download a batch", async () => {
    const adj = await prisma.monthlyPayout.findUniqueOrThrow({
      where: { associateId_payoutMonth_seq: { associateId: closerId, payoutMonth: MONTH, seq: 1 } },
    });
    who.session = ADMIN;
    expect((await setPayoutStatus(adj.id, "Approved")).ok).toBe(true);

    const first = await buildBankFileCsv(MONTH, ADMIN.user.id);
    const mine = (csv: string) => csv.split("\r\n").filter((r) => r.startsWith(`"${TAG}CL"`));
    expect(mine(first.csv)).toEqual([`"${TAG}CL","CL","","","","400.00","Commission ${MONTH} adj 1"`]);
    expect(first.batchId).not.toBeNull();

    const again = await buildBankFileCsv(MONTH, ADMIN.user.id);
    expect(mine(again.csv)).toEqual([]); // already exported
    const redownload = await buildBankFileCsv(MONTH, ADMIN.user.id, { batchId: first.batchId! });
    expect(mine(redownload.csv)).toEqual(mine(first.csv));
  });

  it("refuses to approve a payout whose total is zero or less", async () => {
    const assoc = await prisma.associate.findUniqueOrThrow({ where: { id: closerId } });
    const neg = await prisma.monthlyPayout.create({
      data: {
        payoutMonth: "2099-12", associateId: closerId, associateName: assoc.fullName, designation: assoc.designation,
        totalPayable: "-296", personalCommission: "-296",
      },
    });
    who.session = ADMIN;
    expect(await setPayoutStatus(neg.id, "Approved")).toEqual({ ok: false, error: "payoutNotPositive" });
  });

  it("recomputing a transaction whose lines are already paid keeps them and writes only the delta", async () => {
    const tx1 = await prisma.salesTransaction.findFirstOrThrow({ where: { closingAssociateId: closerId }, orderBy: { createdAt: "asc" } });
    const settledBefore = await prisma.commissionLedger.findMany({ where: { transactionId: tx1.id, payoutId: paidPayoutId } });
    expect(settledBefore.length).toBeGreaterThan(0);

    // The product's closing rate is corrected from 10% to 12% after the payout went out.
    const sv = await prisma.commissionStructureVersion.findFirstOrThrow({ where: { productCode: TAG + "P1" } });
    await prisma.commissionStructureVersion.update({
      where: { id: sv.id }, data: { rateSnapshot: { ...(sv.rateSnapshot as object), closingCommPct: "12" } as never },
    });
    await runCommission(tx1.id);

    const settledAfter = await prisma.commissionLedger.findMany({ where: { transactionId: tx1.id, payoutId: paidPayoutId } });
    expect(settledAfter.map((l) => [l.id, l.amount.toFixed(2)])).toEqual(settledBefore.map((l) => [l.id, l.amount.toFixed(2)]));
    const delta = await prisma.commissionLedger.findMany({ where: { transactionId: tx1.id, associateId: closerId, payoutId: null } });
    expect(delta.map((l) => l.amount.toFixed(2))).toEqual(["200.00"]); // net 1000 now vs 800 settled
    // C3: the recompute that wrote an adjustment against settled commission is audited.
    const adjusted = vi.mocked(logAudit).mock.calls.map(([a]) => a).filter((a) => a.action === "commission.adjusted" && a.entityId === tx1.id);
    expect(adjusted).toHaveLength(1);
    expect(JSON.stringify(adjusted[0].after)).toContain('"amount":"200"');

    who.session = ADMIN;
    expect((await runPayouts(MONTH)).ok).toBe(true);
    const all = await prisma.monthlyPayout.findMany({ where: { associateId: closerId, payoutMonth: MONTH }, orderBy: { seq: "asc" } });
    expect(all.map((x) => [x.seq, x.payoutStatus, x.totalPayable.toFixed(2)])).toEqual([
      [0, "Paid", "800.00"], [1, "Approved", "400.00"], [2, "Pending", "200.00"],
    ]);
  });

  it("a legacy Paid payout without linked lines blocks re-runs, and the dry-run plan proposes linking it", async () => {
    // Simulate a payout paid before payout_id existed: detach its lines.
    const lineIds = (await prisma.commissionLedger.findMany({ where: { payoutId: paidPayoutId }, select: { id: true } })).map((l) => l.id);
    await prisma.commissionLedger.updateMany({ where: { id: { in: lineIds } }, data: { payoutId: null } });

    who.session = ADMIN;
    expect(await runPayouts(MONTH)).toEqual({ ok: false, error: "payoutsNotBackfilled" });

    const plan = (await planPayoutBackfill(prisma)).filter((r) => r.payoutId === paidPayoutId);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ action: "attach", payoutTotal: "800.00", linesTotal: "800.00", possiblyOverwritten: false });
    expect([...plan[0].lineIds].sort()).toEqual([...lineIds].sort());

    // A Paid payout rewritten after its paid date (the M5 signature) is never auto-linked:
    // its lines add up to the rewritten total, not to what was actually paid.
    await prisma.$executeRaw`UPDATE monthly_payouts SET updated_at = paid_date + interval '10 days' WHERE id = ${paidPayoutId}::uuid`;
    const flagged = (await planPayoutBackfill(prisma)).find((r) => r.payoutId === paidPayoutId);
    expect(flagged).toMatchObject({ action: "manual-overwritten", possiblyOverwritten: true });

    // Restore so afterAll's FK-ordered cleanup sees the normal shape.
    await prisma.commissionLedger.updateMany({ where: { id: { in: lineIds } }, data: { payoutId: paidPayoutId } });
  });
});
