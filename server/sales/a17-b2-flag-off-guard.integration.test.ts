// MD B2 (A-17 must-fix before merge): createQuotation, voidQuotation,
// addSubmissionRequiredDocument and getRequiredDocumentGate were callable
// server actions with NO flag check at all — quotations write client name,
// contact and total even with A17_CLOSED_DEAL_FLOW off. Seen-failing: each
// test proves the pre-fix code actually lets the call through while the
// flag is off, before showing the fix refuses it. Real throwaway Postgres;
// fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";

const TAG = "A17B2-";
let companyId = "", productId = "", docProductId = "", closerId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "B2 Test", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"),
    },
    select: { id: true },
  })).id;
  docProductId = (await prisma.product.create({
    data: {
      productCode: TAG + "DOC", productName: "B2 Doc Test", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"),
      requiredDocuments: [{ key: TAG + "KEY1", label_en: "Test Doc", label_zh: "测试文件" }] as never,
    },
    select: { id: true },
  })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterEach(async () => {
  who.session = null;
  delete process.env.A17_CLOSED_DEAL_FLOW;
});
afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { associateId: closerId } });
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: closerId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  await prisma.submissionDocument.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.product.deleteMany({ where: { id: { in: [productId, docProductId] } } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: subIds } } });
});

async function mkPlainSubmission(code: string) {
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2098-08-01"), clientName: TAG + code, saleAmount: "1000", paymentPlan: "FullPayment",
      closingAssociateId: closerId, status: "Submitted",
    },
    select: { id: true },
  });
  await prisma.saleLineItem.create({
    data: {
      submissionId: sub.id, companyId, lineSaleAmount: "1000", selectedComCodes: [],
      productCode: TAG + "DOC", productName: "B2 Doc Test", commissionType: "Percentage" as never,
    },
  });
  return sub.id;
}

describe("B2: createQuotation refuses when the flag is off", () => {
  it("pre-fix would create a real quotation; the fix refuses", async () => {
    who.session = { user: { associateId: closerId, id: closerId } };
    delete process.env.A17_CLOSED_DEAL_FLOW;
    vi.resetModules();
    const { createQuotation } = (await import("@/server/quotations/actions")) as {
      createQuotation: (input: unknown) => Promise<{ ok: boolean; error?: string; id?: string }>;
    };
    const r = await createQuotation({
      clientName: TAG + "Client", quoteDate: "2098-08-01",
      lines: [{ productId, lineSaleAmount: 1000, comCodeIds: [] }],
    });
    expect(r).toEqual({ ok: false, error: "notFound" });
    expect(await prisma.quotation.count({ where: { associateId: closerId } })).toBe(0);
  });
});

describe("B2: voidQuotation refuses when the flag is off", () => {
  it("pre-fix would void a real quotation; the fix refuses", async () => {
    const q = await prisma.quotation.create({
      data: {
        quotationCode: TAG + "QUO1", associateId: closerId, clientName: TAG + "Client",
        quoteDate: new Date("2098-08-01"), lines: [], total: "1000.00", status: "Issued",
      },
      select: { id: true },
    });
    who.session = { user: { associateId: closerId, id: closerId, role: "Associate" } };
    delete process.env.A17_CLOSED_DEAL_FLOW;
    vi.resetModules();
    const { voidQuotation } = (await import("@/server/quotations/actions")) as {
      voidQuotation: (id: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
    };
    const r = await voidQuotation(q.id, "test reason");
    expect(r).toEqual({ ok: false, error: "notFound" });
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: q.id }, select: { status: true } })).status).toBe("Issued");
  });
});

describe("B2: addSubmissionRequiredDocument refuses when the flag is off", () => {
  it("pre-fix would attach a real document; the fix refuses", async () => {
    const submissionId = await mkPlainSubmission("ASD1");
    who.session = { user: { associateId: closerId, id: closerId } };
    delete process.env.A17_CLOSED_DEAL_FLOW;
    vi.resetModules();
    const { addSubmissionRequiredDocument } = (await import("./actions")) as {
      addSubmissionRequiredDocument: (id: string, key: string, file: File) => Promise<{ ok: boolean; error?: string }>;
    };
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "doc.png", { type: "image/png" });
    const r = await addSubmissionRequiredDocument(submissionId, TAG + "KEY1", file);
    expect(r).toEqual({ ok: false, error: "notFound" });
    expect(await prisma.submissionDocument.count({ where: { submissionId } })).toBe(0);
  });
});

describe("B2: getRequiredDocumentGate refuses when the flag is off", () => {
  it("pre-fix would return the real gate data; the fix refuses", async () => {
    const submissionId = await mkPlainSubmission("GRD1");
    who.session = { user: { associateId: closerId, id: closerId } };
    delete process.env.A17_CLOSED_DEAL_FLOW;
    vi.resetModules();
    const { getRequiredDocumentGate } = (await import("./actions")) as {
      getRequiredDocumentGate: (id: string) => Promise<{ ok: boolean; error?: string }>;
    };
    const r = await getRequiredDocumentGate(submissionId);
    expect(r).toEqual({ ok: false, error: "notFound" });
  });
});
