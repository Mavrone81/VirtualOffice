import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    salesSubmission: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    saleLineItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    product: { findMany: vi.fn() },
    commissionStructureVersion: { findMany: vi.fn(async () => []) },
    petsAshesAgreement: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The SEC-6 Net-to-Closer bound has its own tests (split-bounds.test.ts, sec6-split-bounds.integration.test.ts).
vi.mock("@/server/commission/split-bounds", () => ({ splitBoundViolations: vi.fn(async () => []) }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));

import { editSale, type SubmitSaleInput } from "@/server/sales/actions";
import { auditTx } from "@/lib/audit";

const base: SubmitSaleInput & { id: string } = {
  id: "sub1",
  salesDate: "2026-07-20",
  clientName: "  Acme Funerals  ",
  paymentPlan: "Full Payment",
  lines: [{ productId: "prod1", lineSaleAmount: 10000, comCodeIds: ["cc1"] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", associateId: "a1" } });
  prismaMock.salesSubmission.findUnique.mockResolvedValue({
    closingAssociateId: "a1", status: "Submitted", salesDate: new Date("2026-07-20"), saleAmount: 10000,
    // A real SalesSubmission row always has these (editSale's own select
    // includes them) — filled in here, not left undefined, so a run under
    // A-17's shipping configuration (A17_CLOSED_DEAL_FLOW=true ambient)
    // doesn't crash in ashesTermsSnapshot's `D(sub.deposit)` on a fixture gap
    // that has nothing to do with what any of these tests are checking.
    // flow: ClosedDeal (not Legacy) so the same reasoning holds for the
    // legacy-freeze check: inert either way while the flag is off (today),
    // and doesn't wrongly refuse this generic "ordinary edit" test under
    // ambient=true either. The one test that specifically wants Legacy
    // behaviour already sets its own full mock override, unaffected by this.
    paymentPlan: "FullPayment", deposit: null, installmentCount: null, flow: "ClosedDeal",
    associate2Id: null, associate2ValueType: null, associate2Value: null,
    associate3Id: null, associate3ValueType: null, associate3Value: null,
    sdApprovedAt: null, splitAdminApprovedAt: null,
    lineItems: [{ productCode: "P1", lineSaleAmount: 10000, selectedComCodes: [{ comCode: "CC1" }] }],
  });
  prismaMock.product.findMany.mockResolvedValue([
    {
      id: "prod1",
      defaultCompanyId: "co1",
      productCode: "P1",
      productName: "Casket",
      commissionType: "Percentage",
      isExternal: false,
      comCodes: [{ id: "cc1", comCode: "CC1", label: "Base", valueType: "Percentage", value: 10 }],
    },
  ]);
  prismaMock.saleLineItem.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.salesSubmission.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.saleLineItem.createMany.mockResolvedValue({ count: 1 });
  // interactive transaction: run the callback against the same mocks
  prismaMock.$transaction.mockImplementation(async (fn: (db: typeof prismaMock) => unknown) => fn(prismaMock));
});

describe("editSale", () => {
  it("rebuilds the line items + total for a Submitted sale owned by the caller", async () => {
    const r = await editSale(base);
    expect(r.ok).toBe(true);

    // old lines are cleared before the recreate
    expect(prismaMock.saleLineItem.deleteMany).toHaveBeenCalledWith({ where: { submissionId: "sub1" } });

    // the update is a compare-and-swap on a still-Submitted sale of this closer, and
    // carries the trimmed client name + recomputed sale total
    const updateArg = prismaMock.salesSubmission.updateMany.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "sub1", closingAssociateId: "a1", status: "Submitted" });
    expect(updateArg.data.clientName).toBe("Acme Funerals");
    expect(Number(updateArg.data.saleAmount)).toBe(10000);
    expect(prismaMock.saleLineItem.createMany.mock.calls[0][0].data).toHaveLength(1);
    // nothing commission-relevant changed, so no approval fields are touched
    expect(updateArg.data).not.toHaveProperty("sdApprovedAt");

    // both writes run inside one $transaction, and the edit is audited
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Tier A: the audit is written inside that same transaction
    expect(auditTx).toHaveBeenCalledWith(prismaMock, expect.objectContaining({ action: "sale.edited", entityId: "sub1" }));
  });

  it("forbids a caller who is not the closing associate", async () => {
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ closingAssociateId: "someone-else", status: "Submitted" });
    const r = await editSale(base);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("refuses once the sale has left Submitted (already approved/processed)", async () => {
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ closingAssociateId: "a1", status: "QuotationApproved" });
    const r = await editSale(base);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("alreadyProcessed");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns notFound when the submission does not exist", async () => {
    prismaMock.salesSubmission.findUnique.mockResolvedValue(null);
    const r = await editSale(base);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("notFound");
  });

  it("rejects invalid input before touching the database", async () => {
    const r = await editSale({ ...base, lines: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalidInput");
    expect(prismaMock.salesSubmission.findUnique).not.toHaveBeenCalled();
  });

  it("requires an associate profile on the session", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", associateId: null } });
    const r = await editSale(base);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("noAssociateProfile");
  });

  it("A-17: with the closed-deal flag off, never reads or writes the ashes table, even for a row that already has one", async () => {
    // A pre-existing (pre-A-17) manually-created ashesAgreement, and an edit that
    // drops the only product — exactly the shape that would create/void/delete a
    // row if the flag were mistakenly on. It must not be, until env.A17_CLOSED_DEAL_FLOW
    // is set to the exact string "true" (lib/env.ts's bool preprocessor).
    //
    // Forced explicitly rather than relying on the module-level `editSale`
    // above being imported while ambient process.env happened to have the
    // flag unset — that assumption breaks under A-17's own shipping
    // configuration (A17_CLOSED_DEAL_FLOW=true ambient), where this test
    // would otherwise be exercising the flag-ON path while asserting the
    // flag-OFF outcome. Scoped to this one test: resetModules + a fresh
    // dynamic import here doesn't affect the `editSale` binding the other
    // tests in this file use (they keep whichever module instance loaded
    // first, per ES module live-binding semantics).
    delete process.env.A17_CLOSED_DEAL_FLOW;
    vi.resetModules();
    const { editSale: editSaleFlagOff } = (await import("@/server/sales/actions")) as { editSale: typeof editSale };

    prismaMock.salesSubmission.findUnique.mockResolvedValue({
      closingAssociateId: "a1", status: "Submitted", salesDate: new Date("2026-07-20"), saleAmount: 10000,
      associate2Id: null, associate2ValueType: null, associate2Value: null,
      associate3Id: null, associate3ValueType: null, associate3Value: null,
      sdApprovedAt: null, splitAdminApprovedAt: null,
      lineItems: [{ productCode: "P1", lineSaleAmount: 10000, selectedComCodes: [{ comCode: "CC1" }] }],
      flow: "Legacy",
      ashesAgreement: { id: "ashes1", status: "Signed", signatureVersion: 0, signedAt: new Date() },
    });
    const r = await editSaleFlagOff(base);
    expect(r.ok).toBe(true);
    expect(prismaMock.petsAshesAgreement.create).not.toHaveBeenCalled();
    expect(prismaMock.petsAshesAgreement.update).not.toHaveBeenCalled();
    expect(prismaMock.petsAshesAgreement.delete).not.toHaveBeenCalled();
  });
});
