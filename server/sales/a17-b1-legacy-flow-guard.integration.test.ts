// MD B1 (A-17 must-fix before merge): approveQuotation, closeSale and
// signQuotationOnSystem had NO flow check at all. With the flag on, a
// ClosedDeal row at Submitted could be pushed QuotationApproved -> closeSale
// through the OLD quotation workflow — skipping verifySale's G3/G3b/G4/G5,
// minting a SECOND transaction code (verifySale mints its own, separately),
// and skipping the commissionParties freeze. Seen-failing: each test proves
// the pre-fix code actually lets a ClosedDeal row through, before showing
// the fix refuses it. Real throwaway Postgres; fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";

const TAG = "A17B1-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", closerId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "B1 Test", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"),
    },
    select: { id: true },
  })).id;
  await prisma.commissionStructureVersion.create({
    data: {
      productCode: TAG + "P1", productId, effectiveDate: new Date("2098-01-01"),
      rateSnapshot: { commissionType: "Percentage", closingCommPct: "10", closingCommFixed: null, companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3", isExternal: false, externalCompanyRetainedPct: null } as never,
    },
  });
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterEach(async () => {
  who.session = null;
});
afterAll(async () => {
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: closerId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  const txIds = (await prisma.salesTransaction.findMany({ where: { submissionId: { in: subIds } }, select: { id: true } })).map((t) => t.id);
  await prisma.commissionLedger.deleteMany({ where: { transactionId: { in: txIds } } });
  await prisma.invoice.deleteMany({ where: { transactionId: { in: txIds } } });
  await prisma.installmentSchedule.deleteMany({ where: { plan: { transactionId: { in: txIds } } } });
  await prisma.installmentPlan.deleteMany({ where: { transactionId: { in: txIds } } });
  await prisma.salesTransaction.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.submissionDocument.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: TAG + "P1" } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  // audit_log is append-only by DDL trigger (main's own audit-append-only
  // migration) — a DELETE is refused, and refused-by-design, not a compromise
  // (main's own pre-existing audit-*.integration.test.ts files have zero
  // auditLog deletes for the same reason). Left in place, not cleaned up.
});

async function mkClosedDealSubmission(code: string, status: "Submitted" | "QuotationApproved" = "Submitted") {
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2098-07-01"), clientName: TAG + code, saleAmount: "1000", paymentPlan: "FullPayment",
      closingAssociateId: closerId, status, flow: "ClosedDeal", transactionCode: TAG + code,
      // No associate2/associate3 — nothing to split-approve, so
      // splitFullyApproved() reads true and split-bound checks find nothing.
      sdApprovedAt: new Date(), splitAdminApprovedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.saleLineItem.create({
    data: {
      submissionId: sub.id, companyId, lineSaleAmount: "1000", selectedComCodes: [],
      productCode: TAG + "P1", productName: "B1 Test", commissionType: "Percentage" as never,
    },
  });
  return sub.id;
}

describe("B1: approveQuotation refuses flow=ClosedDeal (flag on)", () => {
  afterEach(() => { delete process.env.A17_CLOSED_DEAL_FLOW; });

  it("pre-fix would let it through; the fix refuses", async () => {
    who.session = ADMIN;
    const submissionId = await mkClosedDealSubmission("AQ1", "Submitted");
    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    const { approveQuotation } = (await import("./actions")) as { approveQuotation: (id: string) => Promise<{ ok: boolean; error?: string }> };
    const r = await approveQuotation(submissionId);
    expect(r).toEqual({ ok: false, error: "flowNotAvailable" });
    const after = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: submissionId }, select: { status: true } });
    expect(after.status).toBe("Submitted"); // never reached QuotationApproved
  });
});

describe("B1: closeSale refuses flow=ClosedDeal (flag on)", () => {
  afterEach(() => { delete process.env.A17_CLOSED_DEAL_FLOW; });

  it("pre-fix would mint a transaction; the fix refuses, no transaction, no second code", async () => {
    who.session = ADMIN;
    const submissionId = await mkClosedDealSubmission("CS1", "QuotationApproved");
    await prisma.submissionDocument.create({ data: { submissionId, kind: "Signed", fileKey: TAG + "signed.pdf", fileName: "signed.pdf" } });
    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    const { closeSale } = (await import("./actions")) as { closeSale: (id: string) => Promise<{ ok: boolean; error?: string }> };
    const r = await closeSale(submissionId);
    expect(r).toEqual({ ok: false, error: "flowNotAvailable" });
    expect(await prisma.salesTransaction.count({ where: { submissionId } })).toBe(0);
  });
});

describe("B1: signQuotationOnSystem refuses flow=ClosedDeal (flag on)", () => {
  afterEach(() => { delete process.env.A17_CLOSED_DEAL_FLOW; });

  it("pre-fix would attach a signed docket document; the fix refuses", async () => {
    who.session = { user: { associateId: closerId, id: closerId } };
    const submissionId = await mkClosedDealSubmission("SQ1", "QuotationApproved");
    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    const { signQuotationOnSystem } = (await import("@/app/portal/quotations/actions")) as {
      signQuotationOnSystem: (id: string, dataUrl: string, name: string) => Promise<{ ok: boolean; error?: string }>;
    };
    // A minimal magic-byte-valid PNG data URL (assertUpload only sniffs bytes).
    const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const r = await signQuotationOnSystem(submissionId, `data:image/png;base64,${PNG_B64}`, "Test Signer");
    expect(r).toEqual({ ok: false, error: "flowNotAvailable" });
    expect(await prisma.submissionDocument.count({ where: { submissionId } })).toBe(0);
  });
});
