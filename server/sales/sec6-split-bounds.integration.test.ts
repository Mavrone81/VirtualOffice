// SEC-6 split bounds (T1(L)-DevSecOps), fixtures from the M2 confirmation (T1(L)-DevLead, 2026-09-25): once the SD and an admin
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
import { splitBoundViolations } from "@/server/commission/split-bounds";
import { submitSale, editSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale, approveSplitException } from "./actions";

const TAG = "SEC6BND-";
const SALE_DATE = "2090-04-10";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", sdId = "", smId = "", closerId = "", a2Id = "", a3Id = "", inactiveId = "";

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
      productCode: TAG + "P1", productId, effectiveDate: new Date("2090-01-01"),
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
  a3Id = await mkAssoc("A3", "SalesAssociate", smId, sdId);
  inactiveId = await mkAssoc("IN", "SalesAssociate", smId, sdId);
  await prisma.associate.update({ where: { id: inactiveId }, data: { associateStatus: "Inactive" as never } });
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


const sale = (extra: Record<string, unknown> = {}) => ({
  salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Full Payment",
  lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] as string[] }], ...extra,
});
const pct = (associateId: string, value: number) => ({ associateId, valueType: "Percentage", value });
const abs = (associateId: string, value: number) => ({ associateId, valueType: "Absolute", value });
const asCloser = () => { who.session = { user: { associateId: closerId, id: "33333333-3333-4333-8333-333333333333" } }; };
const sessionAs = (_k: "sd") => ({ user: { associateId: sdId, id: "44444444-4444-4444-8444-444444444444", role: "SalesDirector" } });

describe("SEC-6 (b1): split input bounds", () => {
  it.each([
    ["a single share over 100%", () => ({ associate2: pct(a2Id, 110) }), "splitPercentTooHigh"],
    ["two shares totalling over 100%", () => ({ associate2: pct(a2Id, 60), associate3: pct(a3Id, 50) }), "splitPercentTooHigh"],
    ["the same partner twice", () => ({ associate2: pct(a2Id, 10), associate3: pct(a2Id, 10) }), "splitPartyInvalid"],
    ["the closer as their own partner", () => ({ associate2: pct(closerId, 10) }), "splitPartyInvalid"],
    ["an inactive partner", () => ({ associate2: pct(inactiveId, 10) }), "splitPartyInvalid"],
    ["an unknown partner id", () => ({ associate2: pct("00000000-0000-4000-8000-000000000000", 10) }), "splitPartyInvalid"],
    ["a non-uuid partner id", () => ({ associate2: pct("not-a-uuid", 10) }), "splitPartyInvalid"],
  ])("submitSale refuses %s", async (_n, extra, code) => {
    asCloser();
    const before = await prisma.salesSubmission.count({ where: { closingAssociateId: closerId } });
    expect(await submitSale(sale(extra()) as never)).toEqual({ ok: false, error: code });
    expect(await prisma.salesSubmission.count({ where: { closingAssociateId: closerId } })).toBe(before);
  });

  it("accepts a valid 50% + 50% split, and editSale applies the same bounds", async () => {
    asCloser();
    expect((await submitSale(sale({ associate2: pct(a2Id, 50), associate3: pct(a3Id, 50) }) as never)).ok).toBe(true);
    const id = (await prisma.salesSubmission.findFirstOrThrow({
      where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true },
    })).id;
    expect(await editSale({ ...sale({ associate2: pct(a2Id, 101) }), id } as never)).toEqual({ ok: false, error: "splitPercentTooHigh" });
    expect(await editSale({ ...sale({ associate2: pct(inactiveId, 10) }), id } as never)).toEqual({ ok: false, error: "splitPartyInvalid" });
    const s = await prisma.salesSubmission.findUniqueOrThrow({ where: { id }, select: { associate2Value: true, associate2Id: true } });
    expect([s.associate2Id, Number(s.associate2Value)]).toEqual([a2Id, 50]);
  });
});

describe("B-S6: over-net splits are allowed with a warning, and need a Business Admin split exception to close (net = 8% = 800 here)", () => {
  const latestId = async () => (await prisma.salesSubmission.findFirstOrThrow({
    where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true },
  })).id;
  const state = (id: string) => prisma.salesSubmission.findUniqueOrThrow({
    where: { id },
    select: { splitExceptionRequired: true, splitExceptionApprovedAt: true, splitExceptionReason: true, splitExceptionSnapshot: true, splitEditedAt: true, splitExceptionApprovedById: true },
  });
  // What the admin's page renders for a sale (the same computation as /admin/split-approvals).
  const seenLines = async (id: string) => {
    const x = await prisma.salesSubmission.findUniqueOrThrow({ where: { id }, include: { lineItems: true } });
    return splitBoundViolations(prisma, {
      salesDate: x.salesDate, closingAssociateId: x.closingAssociateId, lines: x.lineItems,
      associate2Id: x.associate2Id, associate2ValueType: x.associate2ValueType, associate2Value: x.associate2Value,
      associate3Id: x.associate3Id, associate3ValueType: x.associate3ValueType, associate3Value: x.associate3Value,
    });
  };
  const version = async (id: string) => (await state(id)).splitEditedAt?.toISOString() ?? null;
  const audits = (action: string, id: string) => vi.mocked(logAudit).mock.calls.map(([a]) => a).filter((a) => a.action === action && a.entityId === id);
  const ACCOUNTS = { user: { associateId: null, id: "22222222-2222-2222-2222-222222222222", role: "Accounts" } };

  /** A submitted sale whose split pushes the closer below zero, with split + quotation approved and a signed doc, ready to close. */
  async function overNetSale(split: number, amount = 10000, quote = true): Promise<string> {
    asCloser();
    const r = await submitSale(sale({ associate2: abs(a2Id, split), lines: [{ productId, lineSaleAmount: amount, comCodeIds: [] }] }) as never);
    expect(r.ok).toBe(true);
    const id = await latestId();
    who.session = ADMIN;
    const v = await version(id);
    expect((await approveSubmissionSplit(id, v)).ok).toBe(true);
    expect((await adminApproveSplit(id, v)).ok).toBe(true);
    if (quote) await quoteAndSign(id);
    return id;
  }

  async function quoteAndSign(id: string) {
    who.session = ADMIN;
    expect((await approveQuotation(id)).ok).toBe(true);
    await prisma.submissionDocument.create({ data: { submissionId: id, kind: "Signed", fileKey: TAG + "signed.pdf", fileName: "signed.pdf" } });
  }

  it.each([
    ["an absolute share above net (900 > 800)", () => ({ associate2: abs(a2Id, 900) }), "-100.00"],
    ["two absolute shares above net (500 + 400)", () => ({ associate2: abs(a2Id, 500), associate3: abs(a3Id, 400) }), "-100.00"],
    ["a percentage + absolute mix above net (60% = 480, + 400)", () => ({ associate2: pct(a2Id, 60), associate3: abs(a3Id, 400) }), "-80.00"],
  ])("submitSale ACCEPTS %s, returns a warning and flags the sale", async (_n, extra, closerAmount) => {
    asCloser();
    const r = await submitSale(sale(extra()) as never) as { ok: boolean; id?: string; warning?: { code: string; lines: { amount: string; associateId: string }[] } };
    expect(r.ok).toBe(true);
    expect(r.warning?.code).toBe("splitExceedsNet");
    expect(r.warning?.lines).toEqual([expect.objectContaining({ lineType: "Personal", associateId: closerId, amount: closerAmount })]);
    expect((await state(r.id!)).splitExceptionRequired).toBe(true);
    expect(audits("split.exception_flagged", r.id!)).toHaveLength(1);
  });

  it("a split exactly equal to net is not flagged", async () => {
    asCloser();
    const r = await submitSale(sale({ associate2: abs(a2Id, 800) }) as never) as { ok: boolean; id?: string; warning?: unknown };
    expect(r.ok).toBe(true);
    expect(r.warning).toBeUndefined();
    expect((await state(r.id!)).splitExceptionRequired).toBe(false);
  });

  it("a flagged sale cannot close until a Business Admin approves the exception", async () => {
    const id = await overNetSale(1000);
    asCloser();
    expect(await closeSale(id)).toEqual({ ok: false, error: "splitExceptionRequired" });
    expect(await prisma.salesTransaction.count({ where: { submissionId: id } })).toBe(0);
    expect(audits("sale.close_refused", id).pop()?.after).toMatchObject({ reason: "splitExceptionRequired" });
  });

  it("only a Business Admin can approve, with a reason, on the version they saw", async () => {
    const id = await overNetSale(1000, 10000, false);
    const v = await version(id);
    who.session = ACCOUNTS;
    expect(await approveSplitException(id, "Director agreed", v, await seenLines(id))).toEqual({ ok: false, error: "forbidden" });
    who.session = sessionAs("sd");
    expect(await approveSplitException(id, "Director agreed", v, await seenLines(id))).toEqual({ ok: false, error: "forbidden" });
    who.session = ADMIN;
    expect(await approveSplitException(id, "  ok ", v, await seenLines(id))).toEqual({ ok: false, error: "splitExceptionReasonRequired" });
    // a page rendered before an edit can't approve the edited split
    asCloser();
    expect((await editSale({ ...sale({ associate2: abs(a2Id, 1100) }), id } as never)).ok).toBe(true);
    who.session = ADMIN;
    expect(await approveSplitException(id, "Director agreed", v, await seenLines(id))).toEqual({ ok: false, error: "splitChangedReload" });
    expect((await state(id)).splitExceptionApprovedAt).toBeNull();
  });

  it("once approved, the sale closes and books the negative closer line visibly", async () => {
    const id = await overNetSale(1000);
    who.session = ADMIN;
    expect(await approveSplitException(id, "Director agreed to pay the partner in full", await version(id), await seenLines(id))).toEqual({ ok: true });
    const st = await state(id);
    expect(st.splitExceptionReason).toBe("Director agreed to pay the partner in full");
    expect(st.splitExceptionSnapshot).toEqual([expect.objectContaining({ lineType: "Personal", associateId: closerId, amount: "-200.00" })]);
    expect(audits("split.exception_approved", id).pop()?.after).toMatchObject({ sameApproverAsSplit: true });
    asCloser();
    expect((await closeSale(id)).ok).toBe(true);
    const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: id } });
    const closer = await prisma.commissionLedger.findMany({ where: { transactionId: tx.id, associateId: closerId, lineType: "Personal" } });
    expect(closer.map((l) => l.amount.toFixed(2))).toEqual(["-200.00"]);
  });

  it("any split edit voids an approved exception, and closing needs a fresh one", async () => {
    const id = await overNetSale(1000, 10000, false);
    who.session = ADMIN;
    expect((await approveSplitException(id, "Director agreed", await version(id), await seenLines(id))).ok).toBe(true);
    asCloser();
    expect((await editSale({ ...sale({ associate2: abs(a2Id, 1050) }), id } as never)).ok).toBe(true);
    const st = await state(id);
    expect([st.splitExceptionApprovedAt, st.splitExceptionReason, st.splitExceptionSnapshot]).toEqual([null, null, null]);
    expect(st.splitExceptionRequired).toBe(true);
    expect(audits("split.exception_voided", id).pop()?.after).toEqual({ reason: "edit" });
    // re-approve the split (SEC-5a cleared it) and the quotation still stands; close needs a new exception
    who.session = ADMIN;
    const v = await version(id);
    await approveSubmissionSplit(id, v); await adminApproveSplit(id, v);
    await quoteAndSign(id);
    asCloser();
    expect(await closeSale(id)).toEqual({ ok: false, error: "splitExceptionRequired" });
  });

  async function setClosingPct(pct: string) {
    await prisma.commissionStructureVersion.create({
      data: {
        productCode: TAG + "P1", productId, effectiveDate: new Date("2090-03-01"),
        rateSnapshot: { commissionType: "Percentage", closingCommPct: pct, closingCommFixed: null, companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3", isExternal: false, externalCompanyRetainedPct: null } as never,
      },
    });
  }
  const dropRate = () => prisma.commissionStructureVersion.deleteMany({ where: { productCode: TAG + "P1", effectiveDate: new Date("2090-03-01") } });

  it("a rate change that makes the negative line deeper voids the exception at close", async () => {
    const id = await overNetSale(1000);            // closer -200 at 10% closing
    who.session = ADMIN;
    expect((await approveSplitException(id, "Director agreed", await version(id), await seenLines(id))).ok).toBe(true);
    await setClosingPct("8");                       // net 600 → closer -400: deeper than approved
    try {
      asCloser();
      expect(await closeSale(id)).toEqual({ ok: false, error: "splitExceptionRequired" });
      expect((await state(id)).splitExceptionApprovedAt).toBeNull();
      expect(audits("split.exception_voided", id).pop()?.after).toMatchObject({ reason: "rates_changed" });
      expect(await prisma.salesTransaction.count({ where: { submissionId: id } })).toBe(0);
    } finally { await dropRate(); }
  });

  it("E1: approving figures that changed after the page rendered is refused", async () => {
    const id = await overNetSale(1000);            // page renders closer -200
    const rendered = await seenLines(id);
    const v = await version(id);
    await setClosingPct("8");                       // before the click, the recompute becomes -400
    try {
      who.session = ADMIN;
      expect(await approveSplitException(id, "Director agreed", v, rendered)).toEqual({ ok: false, error: "splitFiguresChanged" });
      expect((await state(id)).splitExceptionApprovedAt).toBeNull();
      // after reviewing the new figures, the admin can approve them
      expect((await approveSplitException(id, "Director agreed to -400", v, await seenLines(id))).ok).toBe(true);
      expect((await state(id)).splitExceptionSnapshot).toEqual([expect.objectContaining({ amount: "-400.00" })]);
    } finally { await dropRate(); }
  });

  it("a rate change in the associate's favour stays covered and closes", async () => {
    const id = await overNetSale(1000);            // closer -200
    who.session = ADMIN;
    expect((await approveSplitException(id, "Director agreed", await version(id), await seenLines(id))).ok).toBe(true);
    await setClosingPct("11");                      // net 900 → closer -100: within the approval
    try {
      asCloser();
      expect((await closeSale(id)).ok).toBe(true);
    } finally { await dropRate(); }
  });
});
