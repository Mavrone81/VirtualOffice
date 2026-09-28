// A-17 §2 (Q33c): commissionParties freezes WHO earns + each upline's own
// Approved&&Active flag at verify time. Once frozen, a later change to the
// upline's designation/status must NOT change what a recompute books —
// only payment eligibility (commissionEligibility, from A-0/amountCollected)
// stays live. Real throwaway Postgres; drives runCommissionTx/loadCommissionParties
// directly (verifySale itself lands in a later commit) via a real transaction
// booked through the legacy closeSale path, with commissionParties set by hand
// exactly as verifySale will set it.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async () => {
  const real = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...real, logAudit: async () => {} };
});

import { prisma } from "@/lib/db";
import { runCommission } from "./run";
import { buildCommissionPartiesSnapshot } from "./run";

const TAG = "A17PARTIES-";
const SALE_DATE = "2098-06-10";
let companyId = "", productId = "", closerId = "", directUplineId = "";

async function mkAssoc(code: string, designation: string, uplineId?: string) {
  const a = await prisma.associate.create({
    data: {
      associateCode: TAG + code, fullName: code, designation: designation as never,
      approvalStatus: "Approved" as never, associateStatus: "Active" as never,
      directUplineId: uplineId ?? null,
    },
    select: { id: true },
  });
  return a.id;
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Parties Test", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "0",
      defaultCompanyId: companyId, effectiveDate: new Date(SALE_DATE),
    },
    select: { id: true },
  })).id;
  await prisma.commissionStructureVersion.create({
    data: {
      productCode: TAG + "P1", productId, effectiveDate: new Date("2098-01-01"),
      rateSnapshot: { commissionType: "Percentage", closingCommPct: "10", closingCommFixed: null, companyCutPct: "2", smOverridePct: "5", sdOverridePct: "0", isExternal: false, externalCompanyRetainedPct: null } as never,
    },
  });
  directUplineId = await mkAssoc("UP", "SalesManager");
  closerId = await mkAssoc("CL", "SalesAssociate", directUplineId);
});

// Each test may leave the shared upline's status changed — reset before the next.
afterEach(async () => {
  await prisma.associate.update({ where: { id: directUplineId }, data: { associateStatus: "Active" as never } });
});

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: TAG + "P1" } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

async function bookTransaction() {
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date(SALE_DATE), clientName: "Parties Client", saleAmount: 1000,
      paymentPlan: "FullPayment" as never, amountCollected: 0, closingAssociateId: closerId,
      status: "Submitted" as never,
      lineItems: { create: [{ companyId, productCode: TAG + "P1", productName: "Parties Test", commissionType: "Percentage" as never, lineSaleAmount: 1000, isExternal: false }] },
    },
    select: { id: true, lineItems: { select: { id: true } } },
  });
  const closer = await prisma.associate.findUniqueOrThrow({ where: { id: closerId } });
  const txn = await prisma.salesTransaction.create({
    data: {
      transactionCode: `TXN-PARTIES-${sub.id.slice(0, 8)}`, submissionId: sub.id, salesDate: new Date(SALE_DATE),
      clientName: "Parties Client", saleAmount: 1000, paymentPlan: "FullPayment" as never, amountCollected: 0,
      closingAssociateId: closerId, directUplineId: closer.directUplineId, commissionEligibility: "Eligible" as never,
    },
    select: { id: true },
  });
  const version = await prisma.commissionStructureVersion.findFirstOrThrow({ where: { productCode: TAG + "P1" } });
  await prisma.saleLineItem.update({ where: { id: sub.lineItems[0].id }, data: { transactionId: txn.id, structureVersionId: version.id } });
  return txn.id;
}

describe("commissionParties: frozen parties survive a later upline change", () => {
  it("a suspended direct upline (AFTER freezing) still earns the override on this transaction", async () => {
    const txId = await bookTransaction();
    await runCommission(txId, null); // live resolution, upline still Active — establishes the baseline

    const before = await prisma.commissionLedger.findMany({ where: { transactionId: txId, associateId: directUplineId } });
    expect(before.length).toBeGreaterThan(0);

    // Freeze exactly as verifySale will: build the snapshot from live data, store it.
    const tx = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: txId }, include: { closingAssociate: true, submission: true } });
    const snapshot = await buildCommissionPartiesSnapshot(prisma, tx);
    expect(snapshot.directUpline).toEqual({ id: directUplineId, designation: "SalesManager", eligible: true });
    await prisma.salesTransaction.update({ where: { id: txId }, data: { commissionParties: snapshot as never } });

    // Now suspend the upline — live data would say ineligible for a fresh lookup.
    await prisma.associate.update({ where: { id: directUplineId }, data: { associateStatus: "Suspended" as never } });

    await runCommission(txId, null); // recompute against the FROZEN snapshot
    const after = await prisma.commissionLedger.findMany({ where: { transactionId: txId, associateId: directUplineId } });
    expect(after.length).toBe(before.length);
    expect(after.map((l) => l.amount.toString())).toEqual(before.map((l) => l.amount.toString()));
  });

  it("(sanity) without a frozen snapshot, a suspended upline stops earning on the NEXT recompute", async () => {
    const txId = await bookTransaction();
    await runCommission(txId, null);
    const before = await prisma.commissionLedger.findMany({ where: { transactionId: txId, associateId: directUplineId } });
    expect(before.length).toBeGreaterThan(0);

    await prisma.associate.update({ where: { id: directUplineId }, data: { associateStatus: "Suspended" as never } });
    await runCommission(txId, null); // no snapshot — live resolution reacts
    const after = await prisma.commissionLedger.findMany({ where: { transactionId: txId, associateId: directUplineId } });
    expect(after.length).toBe(0);
  });

  it("payment eligibility (commissionEligibility) stays live even with a frozen snapshot", async () => {
    const txId = await bookTransaction();
    await prisma.salesTransaction.update({ where: { id: txId }, data: { commissionEligibility: "PendingCollection" as never } });
    const tx = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: txId }, include: { closingAssociate: true, submission: true } });
    const snapshot = await buildCommissionPartiesSnapshot(prisma, tx);
    await prisma.salesTransaction.update({ where: { id: txId }, data: { commissionParties: snapshot as never } });

    await runCommission(txId, null);
    const pending = await prisma.commissionLedger.findMany({ where: { transactionId: txId } });
    expect(pending.every((l) => l.status === "Pending")).toBe(true);

    // Now the sale collects payment — eligibility flips live, same frozen parties.
    await prisma.salesTransaction.update({ where: { id: txId }, data: { commissionEligibility: "Eligible" as never } });
    await runCommission(txId, null);
    const eligible = await prisma.commissionLedger.findMany({ where: { transactionId: txId } });
    expect(eligible.every((l) => l.status === "Eligible")).toBe(true);
    expect(eligible.some((l) => l.associateId === directUplineId)).toBe(true); // same payee throughout
  });

  it("round-trips the split value through JSON exactly (Decimal-precision string)", async () => {
    const txId = await bookTransaction();
    const tx = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: txId }, include: { closingAssociate: true, submission: true } });
    // Simulate a submission with a Net-to-Closer split partner at a precise value.
    await prisma.salesSubmission.update({ where: { id: tx.submissionId }, data: { associate2Id: directUplineId, associate2ValueType: "Percentage" as never, associate2Value: "33.33" } });
    const txWithSplit = await prisma.salesTransaction.findUniqueOrThrow({ where: { id: txId }, include: { closingAssociate: true, submission: true } });
    const snapshot = await buildCommissionPartiesSnapshot(prisma, txWithSplit);
    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    expect(roundTripped.associate2.value).toBe("33.33");
  });
});
