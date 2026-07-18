import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: { user: { id: "11111111-1111-1111-1111-111111111111", role: "Admin" } } };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { createTeam, addTeamMember, removeTeamMember } from "./actions";

const TAG = "TEAMIT-";
let assocId = "";

beforeAll(async () => {
  const a = await prisma.associate.create({
    data: { associateCode: TAG + "A1", fullName: "Member One", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  });
  assocId = a.id;
});

afterAll(async () => {
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: TAG } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("team actions", () => {
  it("creates a team, adds a member (idempotent), then removes them", async () => {
    who.session = { user: { id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
    const created = await createTeam({ name: TAG + "Alpha" });
    expect(created.ok).toBe(true);
    const teamId = created.id!;

    expect((await addTeamMember({ teamId, associateId: assocId })).ok).toBe(true);
    expect((await addTeamMember({ teamId, associateId: assocId })).ok).toBe(true); // idempotent
    expect(await prisma.teamMember.count({ where: { teamId } })).toBe(1);

    expect((await removeTeamMember({ teamId, associateId: assocId })).ok).toBe(true);
    expect(await prisma.teamMember.count({ where: { teamId } })).toBe(0);
  });

  it("rejects a duplicate team name", async () => {
    who.session = { user: { id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
    expect((await createTeam({ name: TAG + "Beta" })).ok).toBe(true);
    expect(await createTeam({ name: TAG + "Beta" })).toEqual({ ok: false, error: "teamNameTaken" });
  });

  it("forbids a non-Business-Admin from creating a team", async () => {
    who.session = { user: { id: "22222222-2222-2222-2222-222222222222", role: "SalesDirector" } };
    expect(await createTeam({ name: TAG + "Gamma" })).toEqual({ ok: false, error: "forbidden" });
  });
});
