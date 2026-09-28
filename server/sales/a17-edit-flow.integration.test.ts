// A-17 §2/§3/§4 (C2): editSale, behind env.A17_CLOSED_DEAL_FLOW, refuses
// Legacy rows, bumps content_version, and voids/removes/creates the Pet Ash
// draft as a money-relevant term changes. Real throwaway Postgres.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";

const TAG = "A17EDIT-";
let companyId = "", ashesProductId = "", plainProductId = "", closerId = "";
let submitSale: (input: unknown) => Promise<{ ok: boolean; id?: string }>;
let editSale: (input: unknown) => Promise<{ ok: boolean; error?: string }>;

beforeAll(async () => {
  process.env.A17_CLOSED_DEAL_FLOW = "true";
  vi.resetModules();
  ({ submitSale, editSale } = (await import("./actions")) as never);

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
  await prisma.petsAshesAgreement.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.product.deleteMany({ where: { id: { in: [ashesProductId, plainProductId] } } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

afterEach(() => {
  who.session = null;
});

async function submitAshesSale(saleAmount: number) {
  who.session = { user: { associateId: closerId, id: closerId } };
  const r = await submitSale({
    salesDate: "2026-08-01", clientName: "Ashes Client", paymentPlan: "Full Payment",
    lines: [{ productId: ashesProductId, lineSaleAmount: saleAmount, comCodeIds: [] }],
  });
  return r.id!;
}

async function markSigned(agreementId: string) {
  await prisma.petsAshesAgreement.update({
    where: { id: agreementId },
    data: { status: "Signed" as never, signedAt: new Date(), applicantSignatureKey: "fake/sig.png", agreementPdfKey: "fake/agreement.pdf", signedPdfSha256: "a".repeat(64) },
  });
}

describe("editSale — legacy refusal + content_version", () => {
  it("refuses to edit a Legacy row while the flag is on", async () => {
    const subId = await submitAshesSale(1000);
    await prisma.salesSubmission.update({ where: { id: subId }, data: { flow: "Legacy" as never } });
    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await editSale({ id: subId, salesDate: "2026-08-02", clientName: "Renamed", paymentPlan: "Full Payment", lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect(r).toEqual({ ok: false, error: "legacyReadOnly" });
  });

  it("bumps content_version on a successful edit", async () => {
    const subId = await submitAshesSale(1000);
    who.session = { user: { associateId: closerId, id: closerId } };
    const before = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { contentVersion: true } });
    expect(before.contentVersion).toBe(0);
    const r = await editSale({ id: subId, salesDate: "2026-08-02", clientName: "Renamed Client", paymentPlan: "Full Payment", lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect(r.ok).toBe(true);
    const after = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { contentVersion: true } });
    expect(after.contentVersion).toBe(1);
  });
});

describe("editSale — C2 signature void", () => {
  it("voids a signed agreement on a money edit (amount change), keeping the signed file as history", async () => {
    const subId = await submitAshesSale(1000);
    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: { select: { id: true } } } });
    await markSigned(sub.ashesAgreement!.id);

    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await editSale({ id: subId, salesDate: "2026-08-01", clientName: "Ashes Client", paymentPlan: "Full Payment", lines: [{ productId: ashesProductId, lineSaleAmount: 1500, comCodeIds: [] }] });
    expect(r.ok).toBe(true);

    const agreement = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: sub.ashesAgreement!.id } });
    expect(agreement.status).toBe("Draft");
    expect(agreement.signatureVersion).toBe(1);
    // the signed-* columns are cleared (a re-sign must never inherit the
    // PREVIOUS signing's key/hash/terms) — the old values live only in the audit
    expect(agreement.applicantSignatureKey).toBeNull();
    expect(agreement.agreementPdfKey).toBeNull();
    expect(agreement.signedPdfSha256).toBeNull();
    expect(agreement.signedTerms).toBeNull();
    expect(agreement.signedAt).toBeNull();

    const voided = await prisma.auditLog.findMany({ where: { entityId: sub.ashesAgreement!.id, action: "ashes.signature_voided" } });
    expect(voided).toHaveLength(1);
    expect(voided[0].beforeJson).toMatchObject({ agreementPdfKey: "fake/agreement.pdf", applicantSignatureKey: "fake/sig.png", signedPdfSha256: "a".repeat(64), signatureVersion: 0 });
  });

  it("does NOT void a signed agreement on a non-money edit (client contact only)", async () => {
    const subId = await submitAshesSale(1000);
    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: { select: { id: true } } } });
    await markSigned(sub.ashesAgreement!.id);

    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await editSale({ id: subId, salesDate: "2026-08-01", clientName: "Ashes Client", clientContact: "+65 9123 4567", paymentPlan: "Full Payment", lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect(r.ok).toBe(true);

    const agreement = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: sub.ashesAgreement!.id } });
    expect(agreement.status).toBe("Signed");
    expect(agreement.signatureVersion).toBe(0);
  });
});

describe("editSale — draft create/remove as lines change", () => {
  it("hard-deletes a never-signed draft once no line needs it any more", async () => {
    const subId = await submitAshesSale(1000);
    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: { select: { id: true } } } });
    const agreementId = sub.ashesAgreement!.id;

    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await editSale({ id: subId, salesDate: "2026-08-01", clientName: "Ashes Client", paymentPlan: "Full Payment", lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect(r.ok).toBe(true);

    expect(await prisma.petsAshesAgreement.findUnique({ where: { id: agreementId } })).toBeNull();
    const removed = await prisma.auditLog.findMany({ where: { entityId: agreementId, action: "ashes.draft_removed" } });
    expect(removed).toHaveLength(1);
    expect(removed[0].afterJson).toBeNull(); // no contents
  });

  it("✎6: a once-signed agreement is Superseded (not deleted, not left as Draft) once the product is removed", async () => {
    const subId = await submitAshesSale(1000);
    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: { select: { id: true } } } });
    await markSigned(sub.ashesAgreement!.id);

    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await editSale({ id: subId, salesDate: "2026-08-01", clientName: "Ashes Client", paymentPlan: "Full Payment", lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect(r.ok).toBe(true);

    const agreement = await prisma.petsAshesAgreement.findUnique({ where: { id: sub.ashesAgreement!.id } });
    expect(agreement).not.toBeNull();
    expect(agreement!.status).toBe("Superseded");
    expect(agreement!.agreementPdfKey).toBe("fake/agreement.pdf"); // untouched
    expect(agreement!.signedPdfSha256).toBe("a".repeat(64)); // untouched

    const audits = await prisma.auditLog.findMany({ where: { entityId: sub.ashesAgreement!.id, action: "ashes.superseded" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].beforeJson).toMatchObject({ agreementPdfKey: "fake/agreement.pdf", signedPdfSha256: "a".repeat(64), signatureVersion: 0 });
  });

  it("✎6: reinstates a Superseded agreement to Draft (signatureVersion bumped) once a qualifying product is added back", async () => {
    const subId = await submitAshesSale(1000);
    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: { select: { id: true } } } });
    await markSigned(sub.ashesAgreement!.id);

    who.session = { user: { associateId: closerId, id: closerId } };
    await editSale({ id: subId, salesDate: "2026-08-01", clientName: "Ashes Client", paymentPlan: "Full Payment", lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    const superseded = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: sub.ashesAgreement!.id } });
    expect(superseded.status).toBe("Superseded");

    const r = await editSale({ id: subId, salesDate: "2026-08-01", clientName: "Ashes Client", paymentPlan: "Full Payment", lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect(r.ok).toBe(true);

    const reinstated = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: sub.ashesAgreement!.id } });
    expect(reinstated.status).toBe("Draft");
    expect(reinstated.signatureVersion).toBe(1);
    // cleared for the coming re-sign — the old file/key/hash live on in the audit only
    expect(reinstated.agreementPdfKey).toBeNull();
    expect(reinstated.signedPdfSha256).toBeNull();
    expect(reinstated.applicantSignatureKey).toBeNull();

    const audits = await prisma.auditLog.findMany({ where: { entityId: sub.ashesAgreement!.id, action: "ashes.reinstated" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].beforeJson).toMatchObject({ agreementPdfKey: "fake/agreement.pdf", signedPdfSha256: "a".repeat(64) });
  });

  it("creates a draft when an ashes product is added to a sale that had none", async () => {
    who.session = { user: { associateId: closerId, id: closerId } };
    const r0 = await submitSale({
      salesDate: "2026-08-01", clientName: "No Ashes Client", paymentPlan: "Full Payment",
      lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }],
    });
    expect((await prisma.salesSubmission.findUniqueOrThrow({ where: { id: r0.id }, select: { ashesAgreement: true } })).ashesAgreement).toBeNull();

    const r = await editSale({ id: r0.id, salesDate: "2026-08-01", clientName: "No Ashes Client", paymentPlan: "Full Payment", lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect(r.ok).toBe(true);

    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: r0.id }, select: { ashesAgreement: true } });
    expect(sub.ashesAgreement).not.toBeNull();
    expect(sub.ashesAgreement!.status).toBe("Draft");
    const created = await prisma.auditLog.findMany({ where: { entityId: r0.id, action: "ashes.generated" } });
    expect(created).toHaveLength(1);
  });
});
