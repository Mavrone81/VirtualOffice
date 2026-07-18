import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, genTempMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    associate: { findUnique: vi.fn(), update: vi.fn() },
    user: { create: vi.fn() },
    pFile: { upsert: vi.fn() },
  },
  genTempMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/temp-password", () => ({ generateTempPassword: genTempMock }));

import { setApprovalStatus } from "@/server/associates/actions";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin", associateId: null } });
  genTempMock.mockReturnValue("RANDOM-TEMP-9f3a");
  prismaMock.associate.update.mockResolvedValue({});
  prismaMock.user.create.mockResolvedValue({ id: "newuser1" });
  prismaMock.pFile.upsert.mockResolvedValue({});
});

describe("setApprovalStatus provisioning", () => {
  it("provisions the new login with a random temp password and forces a reset", async () => {
    prismaMock.associate.findUnique.mockResolvedValue({
      id: "a1",
      email: "new@enshrine.sg",
      designation: "SalesAssociate",
      user: null,
      approvalStatus: "Pending",
    });

    await setApprovalStatus("a1", "Approved");

    expect(genTempMock).toHaveBeenCalled(); // a per-user random pw, not a shared constant
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.user.create.mock.calls[0][0].data;
    expect(data.mustResetPassword).toBe(true);
    expect(data.email).toBe("new@enshrine.sg");
  });
});
