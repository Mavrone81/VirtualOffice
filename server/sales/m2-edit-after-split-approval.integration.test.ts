// M2 runtime confirmation (T1(L)-DevLead, 2026-09-25): once the SD and an admin
// have approved a Net-to-Closer split, the closer must not be able to change it
// and still close on the old approvals. On 0f89098 editSale is allowed while the
// submission is still Submitted (split flow A runs in parallel with quotation
// flow B) and rewrites associate2/3 without clearing sdApprovedAt /
// splitAdminApprovedAt, so closeSale books the edited split. Needs a local PG
// (DATABASE_URL); fake data only, all rows tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { submitSale, editSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "./actions";

const TAG = "M2EDIT-";
const SALE_DATE = "2099-04-10";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", sdId = "", smId = "", closerId = "", a2Id = "";

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

beforeAll(async () => {
  companyId = (await prisma.company.create({
    data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true },
  })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "M2 Test", commissionType: "Percentage" as never,
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
  a2Id = await mkAssoc("A2", "SalesAssociate", smId, sdId);
});

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
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

describe("M2: editing a split after SD + admin approval", () => {
  let subId = "";
  const sale = {
    salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Full Payment",
    lines: [{ productId: "", lineSaleAmount: 10000, comCodeIds: [] as string[] }],
  };

  it("an approved split cannot be changed and still close on the old approvals", async () => {
    sale.lines[0].productId = productId;
    who.session = { user: { associateId: closerId, id: "sess-closer" } };
    expect((await submitSale({ ...sale, associate2: { associateId: a2Id, valueType: "Percentage", value: 10 } } as never)).ok).toBe(true);
    subId = (await prisma.salesSubmission.findFirstOrThrow({
      where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true },
    })).id;

    // Flow A fully signed off on a 10% split; flow B (quotation) not yet approved.
    who.session = ADMIN;
    expect((await approveSubmissionSplit(subId)).ok).toBe(true);
    expect((await adminApproveSplit(subId)).ok).toBe(true);

    // Closer now raises the partner's share to 90% of net.
    who.session = { user: { associateId: closerId, id: "sess-closer" } };
    const edit = await editSale({ ...sale, id: subId, associate2: { associateId: a2Id, valueType: "Percentage", value: 90 } } as never);

    const after = await prisma.salesSubmission.findUniqueOrThrow({
      where: { id: subId }, select: { associate2Value: true, sdApprovedAt: true, splitAdminApprovedAt: true },
    });
    // Expected: either the edit is refused, or the split approvals are cleared.
    const splitChanged = edit.ok && Number(after.associate2Value) === 90;
    if (splitChanged) {
      expect.soft(after.sdApprovedAt).toBeNull();
      expect.soft(after.splitAdminApprovedAt).toBeNull();
    }

    // And closing must not book the edited split on the old approvals.
    who.session = ADMIN;
    expect((await approveQuotation(subId)).ok).toBe(true);
    await prisma.submissionDocument.create({
      data: { submissionId: subId, kind: "Signed", fileKey: TAG + "signed.pdf", fileName: "signed.pdf" },
    });
    const closed = await closeSale(subId);
    if (closed.ok) {
      const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: subId } });
      const a2 = await prisma.commissionLedger.findMany({ where: { transactionId: tx.id, associateId: a2Id } });
      const a2Total = a2.reduce((s, l) => s + Number(l.amount), 0);
      expect(a2Total).toBeCloseTo(80, 2); // the approved 10% of net 800, not 720
    }
  });

  it("audit for the edit records the split before/after", () => {
    const edits = vi.mocked(logAudit).mock.calls.filter(([a]) => a.action === "sale.edited");
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every(([a]) => a.before !== undefined && a.after !== undefined)).toBe(true);
  });
});
