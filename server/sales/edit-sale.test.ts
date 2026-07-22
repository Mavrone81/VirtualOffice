import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    salesSubmission: { findUnique: vi.fn(), update: vi.fn() },
    saleLineItem: { deleteMany: vi.fn() },
    product: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { editSale, type SubmitSaleInput } from "@/server/sales/actions";
import { logAudit } from "@/lib/audit";

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
  prismaMock.salesSubmission.findUnique.mockResolvedValue({ closingAssociateId: "a1", status: "Submitted" });
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
  prismaMock.salesSubmission.update.mockResolvedValue({});
  prismaMock.$transaction.mockResolvedValue([]);
});

describe("editSale", () => {
  it("rebuilds the line items + total for a Submitted sale owned by the caller", async () => {
    const r = await editSale(base);
    expect(r.ok).toBe(true);

    // old lines are cleared before the recreate
    expect(prismaMock.saleLineItem.deleteMany).toHaveBeenCalledWith({ where: { submissionId: "sub1" } });

    // the update carries the trimmed client name + recomputed sale total
    const updateArg = prismaMock.salesSubmission.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "sub1" });
    expect(updateArg.data.clientName).toBe("Acme Funerals");
    expect(Number(updateArg.data.saleAmount)).toBe(10000);
    expect(updateArg.data.lineItems.create).toHaveLength(1);

    // both writes run inside one $transaction, and the edit is audited
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "sale.edited", entityId: "sub1" }));
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
});
