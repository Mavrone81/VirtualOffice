import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    salesSubmission: { findUnique: vi.fn(), update: vi.fn() },
    associate: { findFirst: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { reassignSplitDirector } from "@/server/sales/actions";

const open = { status: "Submitted", sdApprovedAt: null, splitAdminApprovedAt: null, closedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { role: "Admin", id: "u1" } });
  prismaMock.salesSubmission.findUnique.mockResolvedValue(open);
  prismaMock.salesSubmission.update.mockResolvedValue({});
  prismaMock.associate.findFirst.mockResolvedValue({ id: "d2" }); // a valid director
});

describe("reassignSplitDirector", () => {
  it("reassigns to another Sales Director while the SD step is open", async () => {
    const r = await reassignSplitDirector("s1", "d2");
    expect(r.ok).toBe(true);
    expect(prismaMock.salesSubmission.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { splitDirectorId: "d2" } });
  });

  it("clears the SD when passed null (no director lookup)", async () => {
    const r = await reassignSplitDirector("s1", null);
    expect(r.ok).toBe(true);
    expect(prismaMock.associate.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.salesSubmission.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { splitDirectorId: null } });
  });

  it("rejects a target that is not an active Sales Director", async () => {
    prismaMock.associate.findFirst.mockResolvedValue(null);
    const r = await reassignSplitDirector("s1", "not-a-director");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("notADirector");
    expect(prismaMock.salesSubmission.update).not.toHaveBeenCalled();
  });

  it("refuses once the SD has already approved (step no longer open)", async () => {
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ ...open, sdApprovedAt: new Date() });
    const r = await reassignSplitDirector("s1", "d2");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("alreadyProcessed");
  });

  it("refuses after the admin has signed off the split", async () => {
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ ...open, splitAdminApprovedAt: new Date() });
    expect((await reassignSplitDirector("s1", "d2")).ok).toBe(false);
  });

  it("refuses on a closed sale", async () => {
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ ...open, closedAt: new Date() });
    expect((await reassignSplitDirector("s1", "d2")).ok).toBe(false);
  });

  it("forbids a non-admin", async () => {
    authMock.mockResolvedValue({ user: { role: "SalesDirector", id: "u1", associateId: "d1" } });
    const r = await reassignSplitDirector("s1", "d2");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });
});
