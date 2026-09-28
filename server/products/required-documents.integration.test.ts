// A-17 screen 6: real Postgres, real auditTx, real verifySale/G3 (server/
// sales/actions.ts) — proves the add/remove actions actually drive G3's
// eligibility check, not just that they write the right JSON shape.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";

const TAG = "A17REQDOC-";
const ADMIN_ID = "77777777-7777-7777-7777-777777777777";
const ADMIN = { user: { id: ADMIN_ID, associateId: null, role: "Admin" } };
let productId = "", closerId = "", companyId = "";
let submitSale: (input: unknown) => Promise<{ id?: string }>;
let verifySale: (submissionId: string, seenContentVersion: number) => Promise<{ ok: boolean; error?: string; transactionId?: string }>;
// lib/env.ts's `env` is parsed ONCE at import — setting process.env in
// beforeAll only takes effect for modules imported AFTER that point, so
// these (like submitSale/verifySale) must be dynamic imports, not the
// static top-of-file kind.
let addProductRequiredDocument: (productId: string, input: { labelEn: string; labelZh: string }) => Promise<{ ok: boolean; error?: string; key?: string }>;
let removeProductRequiredDocument: (productId: string, key: string) => Promise<{ ok: boolean; error?: string }>;

beforeAll(async () => {
  process.env.A17_CLOSED_DEAL_FLOW = "true";
  vi.resetModules();
  ({ submitSale, verifySale } = (await import("@/server/sales/actions")) as never);
  ({ addProductRequiredDocument, removeProductRequiredDocument } = (await import("./actions")) as never);

  await installAuditFault();
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Fake product", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"),
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
  await prisma.commissionLedger.deleteMany({ where: { transaction: { submissionId: { in: subIds } } } });
  await prisma.invoice.deleteMany({ where: { transaction: { submissionId: { in: subIds } } } });
  await prisma.salesTransaction.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.submissionDocument.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await removeAuditFault();
});

afterEach(() => {
  who.session = null;
  return clearAuditFaults();
});

async function submitPlain(clientName: string) {
  who.session = { user: { associateId: closerId, id: closerId } };
  const r = await submitSale({
    salesDate: "2026-08-01", clientName, paymentPlan: "Full Payment",
    lines: [{ productId, lineSaleAmount: 1000, comCodeIds: [] }],
  });
  return r.id!;
}
async function approveSplit(subId: string) {
  await prisma.salesSubmission.update({ where: { id: subId }, data: { sdApprovedAt: new Date(), splitAdminApprovedAt: new Date() } });
}
async function verifyAsAdmin(subId: string) {
  who.session = ADMIN;
  return verifySale(subId, 0);
}

describe("addProductRequiredDocument / removeProductRequiredDocument — real G3 round-trip", () => {
  it("add (no doc → G3 refuses; tag a doc → G3 passes), then remove (G3 passes even without a doc)", async () => {
    who.session = ADMIN;
    const added = await addProductRequiredDocument(productId, { labelEn: "Signed Contract", labelZh: "签署合同" });
    expect(added.ok).toBe(true);
    const key = added.key!;

    // No tagged document yet — G3a refuses.
    const sub1 = await submitPlain("G3 Round-trip A");
    await approveSplit(sub1);
    expect(await verifyAsAdmin(sub1)).toEqual({ ok: false, error: "requiredDocumentsMissing" });

    // Tag a document with the generated key — G3a now passes.
    await prisma.submissionDocument.create({
      data: { submissionId: sub1, kind: "Supporting", fileKey: "fake/contract.pdf", fileName: "contract.pdf", requirementKey: key },
    });
    const verified1 = await verifyAsAdmin(sub1);
    expect(verified1.ok).toBe(true);

    // Remove the requirement — a FRESH sale with no tagged document at all
    // now passes G3a too, since it checks the CURRENT product config.
    const removed = await removeProductRequiredDocument(productId, key);
    expect(removed).toEqual({ ok: true });

    const sub2 = await submitPlain("G3 Round-trip B");
    await approveSplit(sub2);
    const verified2 = await verifyAsAdmin(sub2);
    expect(verified2.ok).toBe(true);
  });

  it("Tier A: a failed audit write rolls back the WHOLE add — the product's requiredDocuments is unchanged", async () => {
    who.session = ADMIN;
    await failAuditsFor("product.required_document_added");
    const before = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { requiredDocuments: true } });

    const r = await addProductRequiredDocument(productId, { labelEn: "Should Not Persist", labelZh: "不应保存" });
    expect(r).toEqual({ ok: false, error: "auditUnavailable" });

    const after = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { requiredDocuments: true } });
    expect(after.requiredDocuments).toEqual(before.requiredDocuments);
  });

  it("Tier A: a failed audit write rolls back a remove too — the entry is still there afterward", async () => {
    who.session = ADMIN;
    const added = await addProductRequiredDocument(productId, { labelEn: "Rollback Check", labelZh: "回滚检查" });
    expect(added.ok).toBe(true);

    await failAuditsFor("product.required_document_removed");
    const r = await removeProductRequiredDocument(productId, added.key!);
    expect(r).toEqual({ ok: false, error: "auditUnavailable" });

    const after = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { requiredDocuments: true } });
    expect((after.requiredDocuments as { key: string }[]).some((e) => e.key === added.key)).toBe(true);

    // Clean up for other tests in this file (no fault this time).
    await clearAuditFaults();
    await removeProductRequiredDocument(productId, added.key!);
  });

  it("concurrent adds on one product all land (row lock: no lost update), each with its audit row", async () => {
    who.session = ADMIN;
    for (let round = 0; round < 8; round++) {
      await prisma.product.update({ where: { id: productId }, data: { requiredDocuments: [] } });
      const labels = [`Race A ${round}`, `Race B ${round}`, `Race C ${round}`];
      const results = await Promise.all(labels.map((l) => addProductRequiredDocument(productId, { labelEn: l, labelZh: l })));
      expect(results.every((r) => r.ok)).toBe(true);
      const p = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { requiredDocuments: true } });
      const keys = (p.requiredDocuments as { key: string }[]).map((e) => e.key).sort();
      expect(keys).toEqual(results.map((r) => r.key!).sort());
      const audits = await prisma.auditLog.count({
        where: { action: "product.required_document_added", entityId: productId, afterJson: { path: ["label_en"], string_contains: ` ${round}` } },
      });
      expect(audits).toBeGreaterThanOrEqual(3);
    }
    await prisma.product.update({ where: { id: productId }, data: { requiredDocuments: [] } });
  });

  it("a concurrent remove and add on one product both apply", async () => {
    who.session = ADMIN;
    for (let round = 0; round < 8; round++) {
      await prisma.product.update({ where: { id: productId }, data: { requiredDocuments: [] } });
      const old = await addProductRequiredDocument(productId, { labelEn: `Old ${round}`, labelZh: `Old ${round}` });
      const [rm, add] = await Promise.all([
        removeProductRequiredDocument(productId, old.key!),
        addProductRequiredDocument(productId, { labelEn: `New ${round}`, labelZh: `New ${round}` }),
      ]);
      expect(rm.ok && add.ok).toBe(true);
      const p = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { requiredDocuments: true } });
      expect((p.requiredDocuments as { key: string }[]).map((e) => e.key)).toEqual([add.key]);
    }
    await prisma.product.update({ where: { id: productId }, data: { requiredDocuments: [] } });
  });
});
