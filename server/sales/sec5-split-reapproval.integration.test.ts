// SEC-5 fix coverage (T1(L)-DevSecOps), fixtures from the M2 confirmation (T1(L)-DevLead, 2026-09-25): once the SD and an admin
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

const TAG = "SEC5EDIT-";
const SALE_DATE = "2091-04-10";
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
      productCode: TAG + "P1", productId, effectiveDate: new Date("2091-01-01"),
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


type Sub = { sdApprovedAt: Date | null; splitAdminApprovedAt: Date | null; associate2Value: unknown; clientName: string };
const read = (id: string) => prisma.salesSubmission.findUniqueOrThrow({
  where: { id }, select: { sdApprovedAt: true, splitAdminApprovedAt: true, associate2Value: true, clientName: true },
}) as Promise<Sub>;

describe("SEC-5: split edits vs split approvals", () => {
  const base = () => ({
    salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Full Payment",
    lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] as string[] }],
    associate2: { associateId: a2Id, valueType: "Percentage", value: 10 },
  });
  const closer = () => { who.session = { user: { associateId: closerId, id: "sess-closer" } }; };
  async function approvedSale(): Promise<string> {
    closer();
    expect((await submitSale(base() as never)).ok).toBe(true);
    const id = (await prisma.salesSubmission.findFirstOrThrow({
      where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true },
    })).id;
    who.session = ADMIN;
    expect((await approveSubmissionSplit(id)).ok).toBe(true);
    expect((await adminApproveSplit(id)).ok).toBe(true);
    return id;
  }

  it("a non-money edit (client name) keeps both approvals", async () => {
    const id = await approvedSale();
    closer();
    expect((await editSale({ ...base(), id, clientName: TAG + "Renamed" } as never)).ok).toBe(true);
    const s = await read(id);
    expect(s.clientName).toBe(TAG + "Renamed");
    expect(s.sdApprovedAt).not.toBeNull();
    expect(s.splitAdminApprovedAt).not.toBeNull();
    const audit = vi.mocked(logAudit).mock.calls.map(([a]) => a).filter((a) => a.action === "sale.edited" && a.entityId === id).pop()!;
    expect(audit.after).toMatchObject({ splitChanged: false, approvalsCleared: false });
  });

  it.each([
    ["split value", { associate2: { associateId: "A2", valueType: "Percentage", value: 90 } }],
    ["split type", { associate2: { associateId: "A2", valueType: "Absolute", value: 10 } }],
    ["split party removed", { associate2: "__REMOVE__" }],
    ["line amount", { lines: [{ productId: "P", lineSaleAmount: 20000, comCodeIds: [] }] }],
    ["sales date", { salesDate: "2091-04-11" }],
  ])("a %s change clears both approvals and audits before/after", async (_n, change) => {
    const id = await approvedSale();
    const patch = JSON.parse(JSON.stringify(change).replaceAll('"A2"', JSON.stringify(a2Id)).replaceAll('"P"', JSON.stringify(productId)));
    if (patch.associate2 === "__REMOVE__") patch.associate2 = undefined;
    closer();
    expect((await editSale({ ...base(), ...patch, id } as never)).ok).toBe(true);
    const s = await read(id);
    expect(s.sdApprovedAt).toBeNull();
    expect(s.splitAdminApprovedAt).toBeNull();
    const audit = vi.mocked(logAudit).mock.calls.map(([a]) => a).filter((a) => a.action === "sale.edited" && a.entityId === id).pop()!;
    expect(audit.after).toMatchObject({ splitChanged: true, approvalsCleared: true });
    expect(JSON.stringify(audit.before)).not.toBe(JSON.stringify({ ...(audit.after as object), splitChanged: undefined, approvalsCleared: undefined }));
  });

  it("after re-approval, closing books the split that was re-approved (90% of net 800 = 720)", async () => {
    const id = await approvedSale();
    closer();
    expect((await editSale({ ...base(), id, associate2: { associateId: a2Id, valueType: "Percentage", value: 90 } } as never)).ok).toBe(true);
    who.session = ADMIN;
    expect((await approveQuotation(id)).ok).toBe(true);
    await prisma.submissionDocument.create({ data: { submissionId: id, kind: "Signed", fileKey: TAG + "signed.pdf", fileName: "signed.pdf" } });
    expect(await closeSale(id)).toMatchObject({ ok: false, error: "splitNotApproved" }); // old approvals no longer count
    const v = (await prisma.salesSubmission.findUniqueOrThrow({ where: { id }, select: { splitEditedAt: true } })).splitEditedAt!.toISOString();
    expect((await approveSubmissionSplit(id, v)).ok).toBe(true);
    expect((await adminApproveSplit(id, v)).ok).toBe(true);
    expect((await closeSale(id)).ok).toBe(true);
    const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: id } });
    const a2 = await prisma.commissionLedger.findMany({ where: { transactionId: tx.id, associateId: a2Id } });
    expect(a2.reduce((s, l) => s + Number(l.amount), 0)).toBeCloseTo(720, 2);
  });

  it("an edit after the quotation was approved is refused and changes nothing", async () => {
    const id = await approvedSale();
    who.session = ADMIN;
    expect((await approveQuotation(id)).ok).toBe(true);
    closer();
    expect(await editSale({ ...base(), id, associate2: { associateId: a2Id, valueType: "Percentage", value: 90 } } as never))
      .toEqual({ ok: false, error: "alreadyProcessed" });
    const s = await read(id);
    expect(Number(s.associate2Value)).toBe(10);
    expect(s.splitAdminApprovedAt).not.toBeNull();
  });
});

describe("SEC-5: the SD auto-approve clock restarts at a split edit", () => {
  it("an old sale's edited split waits for the SD again instead of auto-approving", async () => {
    who.session = { user: { associateId: closerId, id: "sess-closer" } };
    expect((await submitSale({
      salesDate: SALE_DATE, clientName: TAG + "Old", paymentPlan: "Full Payment",
      lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] }],
      associate2: { associateId: a2Id, valueType: "Percentage", value: 10 },
    } as never)).ok).toBe(true);
    const id = (await prisma.salesSubmission.findFirstOrThrow({
      where: { closingAssociateId: closerId, clientName: TAG + "Old" }, select: { id: true },
    })).id;
    // Four days old and with an SD assigned: the SD step has auto-approved.
    await prisma.salesSubmission.update({
      where: { id }, data: { createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000), splitDirectorId: sdId },
    });
    who.session = ADMIN;
    expect((await adminApproveSplit(id)).ok).toBe(true);

    // The closer changes the split: both approvals are cleared and the SD clock restarts.
    who.session = { user: { associateId: closerId, id: "sess-closer" } };
    expect((await editSale({
      id, salesDate: SALE_DATE, clientName: TAG + "Old", paymentPlan: "Full Payment",
      lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] }],
      associate2: { associateId: a2Id, valueType: "Percentage", value: 60 },
    } as never)).ok).toBe(true);
    const s = await prisma.salesSubmission.findUniqueOrThrow({ where: { id }, select: { splitEditedAt: true, sdApprovedAt: true } });
    expect(s.splitEditedAt).not.toBeNull();
    expect(s.sdApprovedAt).toBeNull();

    who.session = ADMIN;
    const v = s.splitEditedAt!.toISOString();
    expect(await adminApproveSplit(id, v)).toEqual({ ok: false, error: "pendingSdApproval" });
    expect((await approveSubmissionSplit(id, v)).ok).toBe(true); // explicit SD re-approval
    expect((await adminApproveSplit(id, v)).ok).toBe(true);
  });
});

describe("SA-1: an approval covers only the split version the approver saw", () => {
  async function editedSale(): Promise<{ id: string; oldView: string | null; newView: string }> {
    who.session = { user: { associateId: closerId, id: "sess-closer" } };
    const base = {
      salesDate: SALE_DATE, clientName: TAG + "SA1", paymentPlan: "Full Payment",
      lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] }],
    };
    expect((await submitSale({ ...base, associate2: { associateId: a2Id, valueType: "Percentage", value: 10 } } as never)).ok).toBe(true);
    const id = (await prisma.salesSubmission.findFirstOrThrow({
      where: { closingAssociateId: closerId, clientName: TAG + "SA1" }, orderBy: { createdAt: "desc" }, select: { id: true },
    })).id;
    const oldView = null; // the approver's page rendered the never-edited 10% split
    expect((await editSale({ ...base, id, associate2: { associateId: a2Id, valueType: "Percentage", value: 90 } } as never)).ok).toBe(true);
    const newView = (await prisma.salesSubmission.findUniqueOrThrow({ where: { id }, select: { splitEditedAt: true } })).splitEditedAt!.toISOString();
    await prisma.salesSubmission.update({ where: { id }, data: { clientName: TAG + "SA1-done" } }); // keep later lookups unique
    return { id, oldView, newView };
  }
  const state = (id: string) => prisma.salesSubmission.findUniqueOrThrow({ where: { id }, select: { sdApprovedAt: true, splitAdminApprovedAt: true } });

  it("a stale SD page (rendered before the edit) cannot approve the edited split", async () => {
    const { id, oldView } = await editedSale();
    who.session = ADMIN;
    expect(await approveSubmissionSplit(id, oldView)).toEqual({ ok: false, error: "splitChangedReload" });
    expect(await approveSubmissionSplit(id)).toEqual({ ok: false, error: "splitChangedReload" }); // no version sent = never-edited view
    expect((await state(id)).sdApprovedAt).toBeNull();
  });

  it("a stale admin page cannot sign off the edited split", async () => {
    const { id, oldView, newView } = await editedSale();
    who.session = ADMIN;
    expect((await approveSubmissionSplit(id, newView)).ok).toBe(true);
    expect(await adminApproveSplit(id, oldView)).toEqual({ ok: false, error: "splitChangedReload" });
    expect((await state(id)).splitAdminApprovedAt).toBeNull();
  });

  it("a fresh page approves, and a repeat approval of the same version is idempotent", async () => {
    const { id, newView } = await editedSale();
    who.session = ADMIN;
    expect((await approveSubmissionSplit(id, newView)).ok).toBe(true);
    expect((await approveSubmissionSplit(id, newView)).ok).toBe(true);
    expect((await adminApproveSplit(id, newView)).ok).toBe(true);
    expect((await adminApproveSplit(id, newView)).ok).toBe(true);
    const s = await state(id);
    expect(s.sdApprovedAt).not.toBeNull();
    expect(s.splitAdminApprovedAt).not.toBeNull();
  });
});
