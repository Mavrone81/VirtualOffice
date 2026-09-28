// A-17 (DevLead review of 4c400a4): signAshesAgreement must be race-safe
// (two concurrent signs can't both win) and leave no half-signed state if
// rendering/storage fails after the CAS claims the row. Real throwaway
// Postgres; renderAshesAgreementPdf is wrapped so one test can force it to
// throw without touching the others.
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

const TAG = "A17SIGNRACE-";
let companyId = "", ashesProductId = "", closerId = "";
let submitSale: (input: unknown) => Promise<{ id?: string }>;
let signAshesAgreement: (submissionId: string, dataUrl: string) => Promise<{ ok: boolean; error?: string }>;

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
  control.forceRenderFailure = false;
});

async function newDraft(clientName: string) {
  who.session = { user: { associateId: closerId, id: closerId } };
  const r = await submitSale({
    salesDate: "2026-08-01", clientName, paymentPlan: "Full Payment",
    lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }],
  });
  return r.id!;
}

describe("signAshesAgreement — race safety", () => {
  it("two concurrent signs on the same Draft: exactly one succeeds", async () => {
    const subId = await newDraft("Race Client");
    who.session = { user: { associateId: closerId, id: closerId } };
    const [a, b] = await Promise.all([
      signAshesAgreement(subId, FAKE_PNG_DATA_URL),
      signAshesAgreement(subId, FAKE_PNG_DATA_URL),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "alreadyProcessed")).toHaveLength(1);

    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: true } });
    expect(sub.ashesAgreement!.status).toBe("Signed");
  });

  it("leaves no half-signed state when rendering fails after the CAS claims the row", async () => {
    const subId = await newDraft("Render Fail Client");
    const before = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: true } });

    control.forceRenderFailure = true;
    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await signAshesAgreement(subId, FAKE_PNG_DATA_URL);
    expect(r).toEqual({ ok: false, error: "signingFailed" });

    const after = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: before.ashesAgreement!.id } });
    expect(after.status).toBe("Draft");
    expect(after.signedAt).toBeNull();
    expect(after.applicantSignatureKey).toBeNull();
    expect(after.signedTerms).toBeNull();
    expect(after.agreementPdfKey).toBeNull();

    // a retry (render working again) succeeds cleanly from this reverted state
    control.forceRenderFailure = false;
    const retry = await signAshesAgreement(subId, FAKE_PNG_DATA_URL);
    expect(retry).toEqual({ ok: true });
  });
});
