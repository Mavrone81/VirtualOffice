// A-17 C2/§4: signAshesAgreement must snapshot the terms it covers
// (signedTerms, the same shape ashesTermsChanged/G3 will use) and the
// rendered PDF's real SHA-256 (signedPdfSha256) — both were previously never
// written, leaving C2's "prior snapshot" audit with nothing real to carry.
// Also: a Superseded row refuses to be signed directly (✎6).
// Real throwaway Postgres.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createHash } from "crypto";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";

const TAG = "A17SIGN-";
let companyId = "", ashesProductId = "", closerId = "";
let submitSale: (input: unknown) => Promise<{ id?: string }>;
let signAshesAgreement: (submissionId: string, dataUrl: string) => Promise<{ ok: boolean; error?: string }>;

// Minimal magic-byte-valid fake PNG (sniffFileType only checks the first 4 bytes).
const FAKE_PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const FAKE_PNG_DATA_URL = `data:image/png;base64,${FAKE_PNG_BASE64}`;

beforeAll(async () => {
  process.env.A17_CLOSED_DEAL_FLOW = "true";
  vi.resetModules();
  ({ submitSale } = (await import("@/server/sales/actions")) as never);
  ({ signAshesAgreement } = (await import("./actions")) as never);

  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  ashesProductId = (await prisma.product.create({
    data: {
      productCode: TAG + "ASH", productName: "Columbarium Niche", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"), requiresAshesAgreement: true,
    },
    select: { id: true },
  })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  delete process.env.A17_CLOSED_DEAL_FLOW;
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: closerId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  await prisma.submissionDocument.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.petsAshesAgreement.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.product.deleteMany({ where: { id: ashesProductId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

afterEach(() => {
  who.session = null;
});

describe("signAshesAgreement — terms snapshot + PDF hash", () => {
  it("stores signedTerms matching the sale, and a signedPdfSha256 matching the real stored file", async () => {
    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await submitSale({
      salesDate: "2026-08-01", clientName: "Sign Test Client", paymentPlan: "Full Payment",
      lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }],
    });
    const subId = r.id!;

    const before = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: true } });
    expect(before.ashesAgreement!.signedTerms).toBeNull();
    expect(before.ashesAgreement!.signedPdfSha256).toBeNull();

    const signed = await signAshesAgreement(subId, FAKE_PNG_DATA_URL);
    expect(signed).toEqual({ ok: true });

    const after = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: before.ashesAgreement!.id } });
    expect(after.status).toBe("Signed");
    expect(after.signedTerms).toEqual({ saleAmount: "1000.00", paymentPlan: "FullPayment", deposit: null, installmentCount: null, products: [TAG + "ASH"] });
    expect(after.signedPdfSha256).toMatch(/^[0-9a-f]{64}$/);

    const stored = await getObject(after.agreementPdfKey!);
    expect(createHash("sha256").update(stored!).digest("hex")).toBe(after.signedPdfSha256);
  });

  it("refuses to sign a Superseded agreement directly", async () => {
    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await submitSale({
      salesDate: "2026-08-01", clientName: "Superseded Test Client", paymentPlan: "Full Payment",
      lines: [{ productId: ashesProductId, lineSaleAmount: 500, comCodeIds: [] }],
    });
    const subId = r.id!;
    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: true } });
    await prisma.petsAshesAgreement.update({ where: { id: sub.ashesAgreement!.id }, data: { status: "Superseded" as never, signedAt: new Date() } });

    const r2 = await signAshesAgreement(subId, FAKE_PNG_DATA_URL);
    expect(r2).toEqual({ ok: false, error: "alreadyProcessed" });
  });
});
