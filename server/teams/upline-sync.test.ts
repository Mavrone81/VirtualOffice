import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    team: { findUnique: vi.fn() },
    teamMember: { upsert: vi.fn() },
    associate: { update: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { addTeamMember } from "@/server/teams/actions";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
  prismaMock.teamMember.upsert.mockResolvedValue({});
  prismaMock.associate.update.mockResolvedValue({});
});

// 16-Jul: approval follows the team, so adding a member syncs their direct
// upline to the team Director (keeps commission overrides + approval in sync).
describe("addTeamMember → upline sync", () => {
  it("sets the member's direct upline to the team director", async () => {
    prismaMock.team.findUnique.mockResolvedValue({ directorId: "d1" });
    const r = await addTeamMember({ teamId: "t1", associateId: "a1" });
    expect(r.ok).toBe(true);
    expect(prismaMock.associate.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { directUplineId: "d1" } });
  });

  it("does not touch upline when the team has no director", async () => {
    prismaMock.team.findUnique.mockResolvedValue({ directorId: null });
    await addTeamMember({ teamId: "t1", associateId: "a1" });
    expect(prismaMock.associate.update).not.toHaveBeenCalled();
  });

  it("does not set a director as their own upline", async () => {
    prismaMock.team.findUnique.mockResolvedValue({ directorId: "d1" });
    await addTeamMember({ teamId: "t1", associateId: "d1" });
    expect(prismaMock.associate.update).not.toHaveBeenCalled();
  });
});
