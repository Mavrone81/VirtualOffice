import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, runCommissionMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    salesSubmission: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  runCommissionMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/server/commission/run", () => ({ runCommission: runCommissionMock }));

import { adminApproveSplit, closeSale } from "@/server/sales/actions";

const OLD = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000); // 4 days ago → past the 3-day auto

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.salesSubmission.update.mockResolvedValue({});
  prismaMock.$transaction.mockResolvedValue("tx-1");
  runCommissionMock.mockResolvedValue(1);
});

describe("adminApproveSplit", () => {
  it("signs off a split whose SD step has landed", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({
      status: "Submitted", sdApprovedAt: new Date(), createdAt: new Date(), splitAdminApprovedAt: null, splitDirectorId: "d1", closedAt: null,
    });
    const r = await adminApproveSplit("s1");
    expect(r.ok).toBe(true);
    const arg = prismaMock.salesSubmission.update.mock.calls[0][0];
    expect(arg.data.splitAdminApprovedById).toBe("u1");
    expect(arg.data.splitAdminApprovedAt).toBeInstanceOf(Date);
  });

  it("stamps a system sdApprovedAt when the SD step only auto-approved", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({
      status: "Submitted", sdApprovedAt: null, createdAt: OLD, splitAdminApprovedAt: null, splitDirectorId: "d1", closedAt: null,
    });
    const r = await adminApproveSplit("s1");
    expect(r.ok).toBe(true);
    expect(prismaMock.salesSubmission.update.mock.calls[0][0].data.sdApprovedAt).toBeInstanceOf(Date);
  });

  it("refuses before the SD step (no explicit approval, not yet 3 days)", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({
      status: "Submitted", sdApprovedAt: null, createdAt: new Date(), splitAdminApprovedAt: null, splitDirectorId: "d1", closedAt: null,
    });
    const r = await adminApproveSplit("s1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("pendingSdApproval");
    expect(prismaMock.salesSubmission.update).not.toHaveBeenCalled();
  });

  it("lets the admin sign off immediately when no SD is assigned", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({
      status: "Submitted", sdApprovedAt: null, createdAt: new Date(), splitAdminApprovedAt: null, splitDirectorId: null, closedAt: null,
    });
    const r = await adminApproveSplit("s1");
    expect(r.ok).toBe(true);
    // records the SD step as a system stamp since there was no SD to act.
    expect(prismaMock.salesSubmission.update.mock.calls[0][0].data.sdApprovedAt).toBeInstanceOf(Date);
  });

  it("is idempotent once already admin-approved", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({
      status: "Submitted", sdApprovedAt: new Date(), createdAt: new Date(), splitAdminApprovedAt: new Date(), splitDirectorId: "d1", closedAt: null,
    });
    const r = await adminApproveSplit("s1");
    expect(r.ok).toBe(true);
    expect(prismaMock.salesSubmission.update).not.toHaveBeenCalled();
  });

  it("rejects a non-admin", async () => {
    authMock.mockResolvedValue({ user: { role: "SalesDirector", id: "u1", associateId: "d1" } });
    const r = await adminApproveSplit("s1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });
});

describe("closeSale", () => {
  const ready = {
    closingAssociateId: "a1",
    status: "QuotationApproved",
    transaction: null,
    sdApprovedAt: new Date(),
    createdAt: new Date(),
    splitAdminApprovedAt: new Date(),
    _count: { documents: 1 },
    lineItems: [],
    closingAssociate: { directUplineId: null, secondUplineId: null },
  };

  it("mints the transaction when both flows are approved and a signed doc is present", async () => {
    authMock.mockResolvedValue({ user: { associateId: "a1", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue(ready);
    const r = await closeSale("s1");
    expect(r.ok).toBe(true);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(runCommissionMock).toHaveBeenCalledWith("tx-1");
  });

  it("no-ops when the sale already has a transaction", async () => {
    authMock.mockResolvedValue({ user: { associateId: "a1", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ ...ready, transaction: { id: "tx-existing" } });
    const r = await closeSale("s1");
    expect(r.ok).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("refuses if the quotation generation is not yet approved", async () => {
    authMock.mockResolvedValue({ user: { associateId: "a1", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ ...ready, status: "Submitted" });
    const r = await closeSale("s1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("quotationNotApproved");
  });

  it("refuses if the split is not fully approved", async () => {
    authMock.mockResolvedValue({ user: { associateId: "a1", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ ...ready, splitAdminApprovedAt: null });
    const r = await closeSale("s1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("splitNotApproved");
  });

  it("refuses without a signed quotation in the docket", async () => {
    authMock.mockResolvedValue({ user: { associateId: "a1", id: "u1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ ...ready, _count: { documents: 0 } });
    const r = await closeSale("s1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("signedDocRequired");
  });

  it("forbids a non-closer, non-admin", async () => {
    authMock.mockResolvedValue({ user: { associateId: "someone-else", id: "u1", role: "SalesAssociate" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue(ready);
    const r = await closeSale("s1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });
});
