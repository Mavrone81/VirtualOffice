import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { team: { findUnique: vi.fn(), update: vi.fn() }, associate: { updateMany: vi.fn() } },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { setTeamDirector } from "@/server/teams/actions";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
  prismaMock.team.update.mockResolvedValue({});
  prismaMock.associate.updateMany.mockResolvedValue({});
});

describe("setTeamDirector", () => {
  it("changes the director and re-syncs members' upline (excluding the new director)", async () => {
    prismaMock.team.findUnique.mockResolvedValue({ members: [{ associateId: "m1" }, { associateId: "m2" }, { associateId: "d2" }] });
    const r = await setTeamDirector({ teamId: "t1", directorId: "d2" });
    expect(r.ok).toBe(true);
    expect(prismaMock.team.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { directorId: "d2" } });
    expect(prismaMock.associate.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["m1", "m2"] } }, data: { directUplineId: "d2" } });
  });

  it("clearing the director does not re-sync anyone", async () => {
    prismaMock.team.findUnique.mockResolvedValue({ members: [{ associateId: "m1" }] });
    const r = await setTeamDirector({ teamId: "t1", directorId: null });
    expect(r.ok).toBe(true);
    expect(prismaMock.associate.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "SalesDirector" } });
    expect((await setTeamDirector({ teamId: "t1", directorId: "d2" })).ok).toBe(false);
  });
});
