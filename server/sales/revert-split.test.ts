import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { salesSubmission: { findUnique: vi.fn(), update: vi.fn() }, team: { findFirst: vi.fn() } },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { revertSplitApproval } from "@/server/sales/actions";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.salesSubmission.update.mockResolvedValue({});
});

describe("revertSplitApproval", () => {
  it("lets an admin revert an approved split that isn't quotation-approved yet", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", associateId: null } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ status: "Submitted", sdApprovedAt: new Date(), closingAssociateId: "a1" });
    const r = await revertSplitApproval("s1");
    expect(r.ok).toBe(true);
    expect(prismaMock.salesSubmission.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { sdApprovedAt: null, sdApprovedById: null } });
  });

  it("refuses once the quotation is approved (status no longer Submitted)", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", associateId: null } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ status: "QuotationApproved", sdApprovedAt: new Date(), closingAssociateId: "a1" });
    expect((await revertSplitApproval("s1")).ok).toBe(false);
    expect(prismaMock.salesSubmission.update).not.toHaveBeenCalled();
  });

  it("rejects a Director who does not direct the closer's team", async () => {
    authMock.mockResolvedValue({ user: { role: "SalesDirector", associateId: "d1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ status: "Submitted", sdApprovedAt: new Date(), closingAssociateId: "a1" });
    prismaMock.team.findFirst.mockResolvedValue(null);
    expect((await revertSplitApproval("s1")).ok).toBe(false);
  });

  it("errors when there is nothing approved to revert", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", associateId: null } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ status: "Submitted", sdApprovedAt: null, closingAssociateId: "a1" });
    expect((await revertSplitApproval("s1")).ok).toBe(false);
  });
});
