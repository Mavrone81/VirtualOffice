// A-17 (DevLead review of 33f975f): a re-sign after C2 void, or after
// supersede+reinstate, must never inherit the PREVIOUS signing's key/hash —
// the row is genuinely clean Draft first. Real throwaway Postgres;
// renderAshesAgreementPdf wrapped so one test can force it to fail.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
const control = { forceRenderFailure: false };

vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pdf/ashes-agreement", async () => {
  const real = await vi.importActual<typeof import("@/lib/pdf/ashes-agreement")>("@/lib/pdf/ashes-agreement");
  return {
    ...real,
    renderAshesAgreementPdf: async (id: string) => {
      if (control.forceRenderFailure) throw new Error("forced render failure for test");
      return real.renderAshesAgreementPdf(id);
    },
  };
});

import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";

const TAG = "A17RESIGN-";
let companyId = "", ashesProductId = "", plainProductId = "", closerId = "";
let submitSale: (input: unknown) => Promise<{ id?: string }>;
let editSale: (input: unknown) => Promise<{ ok: boolean; error?: string }>;
let signAshesAgreement: (submissionId: string, dataUrl: string) => Promise<{ ok: boolean; error?: string }>;

const FAKE_PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const FAKE_PNG_DATA_URL = `data:image/png;base64,${FAKE_PNG_BASE64}`;

beforeAll(async () => {
  process.env.A17_CLOSED_DEAL_FLOW = "true";
  vi.resetModules();
  ({ submitSale, editSale } = (await import("@/server/sales/actions")) as never);
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
  plainProductId = (await prisma.product.create({
    data: {
      productCode: TAG + "PLN", productName: "Grave Plot", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"), requiresAshesAgreement: false,
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
  await prisma.product.deleteMany({ where: { id: { in: [ashesProductId, plainProductId] } } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

afterEach(() => {
  who.session = null;
  control.forceRenderFailure = false;
});

async function newAshesSubmission(clientName: string) {
  who.session = { user: { associateId: closerId, id: closerId } };
  const r = await submitSale({
    salesDate: "2026-08-01", clientName, paymentPlan: "Full Payment",
    lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }],
  });
  return r.id!;
}

describe("re-sign after C2 void, with a forced render failure on the re-sign attempt", () => {
  it("leaves the row Draft with every signed-* column null; the audit still holds the FIRST signing's key/sha; the first PDF file survives", async () => {
    const subId = await newAshesSubmission("Resign After Void");
    who.session = { user: { associateId: closerId, id: closerId } };
    expect(await signAshesAgreement(subId, FAKE_PNG_DATA_URL)).toEqual({ ok: true });

    const signed = await prisma.petsAshesAgreement.findFirstOrThrow({ where: { submissionId: subId } });
    const firstKey = signed.agreementPdfKey!;
    const firstSha = signed.signedPdfSha256!;
    expect(await getObject(firstKey)).not.toBeNull();

    // C2 void: a non-amount term change while still needed (payment plan) —
    // the sale amount lock (PD ruling) now refuses an amount-changing edit
    // against a signed agreement outright instead of voiding it, so this
    // void must come from a genuine non-money term change instead.
    const voidEdit = await editSale({ id: subId, salesDate: "2026-08-01", clientName: "Resign After Void", paymentPlan: "Installment", installmentCount: 3, lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect(voidEdit.ok).toBe(true);
    const voided = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: signed.id } });
    expect(voided.status).toBe("Draft");
    expect(voided.agreementPdfKey).toBeNull();

    control.forceRenderFailure = true;
    const failedResign = await signAshesAgreement(subId, FAKE_PNG_DATA_URL);
    expect(failedResign).toEqual({ ok: false, error: "signingFailed" });

    const afterFailure = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: signed.id } });
    expect(afterFailure.status).toBe("Draft");
    expect(afterFailure.agreementPdfKey).toBeNull();
    expect(afterFailure.signedPdfSha256).toBeNull();
    expect(afterFailure.applicantSignatureKey).toBeNull();
    expect(afterFailure.signedAt).toBeNull();

    const voidAudit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: signed.id, action: "ashes.signature_voided" } });
    expect(voidAudit.beforeJson).toMatchObject({ agreementPdfKey: firstKey, signedPdfSha256: firstSha });
    // the first PDF is untouched — a failed re-sign attempt only cleaned up its OWN key
    expect(await getObject(firstKey)).not.toBeNull();
  });
});

describe("re-sign after supersede + reinstate", () => {
  it("succeeds with a new signature key different from the first", async () => {
    const subId = await newAshesSubmission("Resign After Reinstate");
    who.session = { user: { associateId: closerId, id: closerId } };
    expect(await signAshesAgreement(subId, FAKE_PNG_DATA_URL)).toEqual({ ok: true });
    const signed = await prisma.petsAshesAgreement.findFirstOrThrow({ where: { submissionId: subId } });
    const firstSignatureKey = signed.applicantSignatureKey!;

    // Supersede: the ashes product is dropped.
    await editSale({ id: subId, salesDate: "2026-08-01", clientName: "Resign After Reinstate", paymentPlan: "Full Payment", lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect((await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: signed.id } })).status).toBe("Superseded");

    // Reinstate: the ashes product comes back.
    await editSale({ id: subId, salesDate: "2026-08-01", clientName: "Resign After Reinstate", paymentPlan: "Full Payment", lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    const reinstated = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: signed.id } });
    expect(reinstated.status).toBe("Draft");
    expect(reinstated.applicantSignatureKey).toBeNull();

    const resign = await signAshesAgreement(subId, FAKE_PNG_DATA_URL);
    expect(resign).toEqual({ ok: true });
    const final = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: signed.id } });
    expect(final.status).toBe("Signed");
    expect(final.applicantSignatureKey).not.toBeNull();
    expect(final.applicantSignatureKey).not.toBe(firstSignatureKey);
  });
});
