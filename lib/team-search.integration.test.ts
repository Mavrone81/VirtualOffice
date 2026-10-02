// resolveTeamSearchScope is the one security-load-bearing piece of the
// "search by individual/team" feature: a client-supplied candidate must be
// checked against this associate's own server-computed scope before it is
// ever used to filter anything (owner/DevSecOps requirement). Real
// throwaway Postgres (needs DATABASE_URL); fake data only, all rows tagged
// and cleaned up.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resolveTeamSearchScope, parseTeamSearchParam } from "./team";

const TAG = "TMSRCH-";
let directorId = "", memberId = "", strangerId = "", ownTeamId = "", otherDirectorId = "", otherTeamId = "";

beforeAll(async () => {
  directorId = (await prisma.associate.create({
    data: { associateCode: TAG + "DIR", fullName: "Director Test", designation: "SalesDirector" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  memberId = (await prisma.associate.create({
    data: { associateCode: TAG + "MEM", fullName: "Member Test", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  // A real associate, but in NEITHER the director's team NOR their downline —
  // the out-of-scope candidate for the "individual" case.
  strangerId = (await prisma.associate.create({
    data: { associateCode: TAG + "STR", fullName: "Stranger Test", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  otherDirectorId = (await prisma.associate.create({
    data: { associateCode: TAG + "OD", fullName: "Other Director Test", designation: "SalesDirector" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;

  // The director is ALSO listed as a member of their own team (a real,
  // supported shape in this data model) — the parity case DevLead's review
  // caught: the default view excludes self, so a team-search result must
  // too, or "Team Commission" would silently include the caller's own
  // figures only when searched by team.
  ownTeamId = (await prisma.team.create({
    data: { name: TAG + "OwnTeam", directorId, active: true, members: { create: [{ associateId: memberId }, { associateId: directorId }] } },
    select: { id: true },
  })).id;
  // A team that exists, is active, but belongs to a DIFFERENT director — the
  // out-of-scope candidate for the "team" case.
  otherTeamId = (await prisma.team.create({
    data: { name: TAG + "OtherTeam", directorId: otherDirectorId, active: true },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.team.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("parseTeamSearchParam", () => {
  it("parses ind:<id> and team:<id>", () => {
    expect(parseTeamSearchParam("ind:abc")).toEqual({ type: "individual", value: "abc" });
    expect(parseTeamSearchParam("team:xyz")).toEqual({ type: "team", value: "xyz" });
  });
  it("returns null for absent, empty, or unrecognized-prefix input (never throws on a hand-edited URL)", () => {
    expect(parseTeamSearchParam(undefined)).toBeNull();
    expect(parseTeamSearchParam("")).toBeNull();
    expect(parseTeamSearchParam("bogus:1")).toBeNull();
    expect(parseTeamSearchParam("ind:")).toBeNull();
  });
});

describe("resolveTeamSearchScope — the candidate is checked against the server's own scope, never trusted", () => {
  it("returns null when no search is applied", async () => {
    expect(await resolveTeamSearchScope(directorId, null)).toBeNull();
  });

  it("an individual candidate actually in scope resolves to just that one id", async () => {
    const scope = await resolveTeamSearchScope(directorId, { type: "individual", value: memberId });
    expect(scope).toEqual([memberId]);
  });

  // The DevSecOps-required boundary: a real associate id, NOT in this
  // director's scope, must be refused — never passed through to a query.
  it("an individual candidate NOT in scope is refused (returns null, not the stranger's own id)", async () => {
    const scope = await resolveTeamSearchScope(directorId, { type: "individual", value: strangerId });
    expect(scope).toBeNull();
  });

  it("a team candidate the director owns resolves to that team's OTHER member ids, excluding the director's own (parity with the default, self-excluded view)", async () => {
    const scope = await resolveTeamSearchScope(directorId, { type: "team", value: ownTeamId });
    expect(scope).toEqual([memberId]); // NOT [memberId, directorId] — the fixture's team has both as members
  });

  // The DevSecOps-required boundary, team side: a real, active team id
  // belonging to a DIFFERENT director must be refused.
  it("a team candidate belonging to a DIFFERENT director is refused (returns null, not that team's members)", async () => {
    const scope = await resolveTeamSearchScope(directorId, { type: "team", value: otherTeamId });
    expect(scope).toBeNull();
  });

  it("a syntactically valid but nonexistent id is refused the same way as an out-of-scope one", async () => {
    expect(await resolveTeamSearchScope(directorId, { type: "individual", value: "00000000-0000-0000-0000-000000000000" })).toBeNull();
    expect(await resolveTeamSearchScope(directorId, { type: "team", value: "00000000-0000-0000-0000-000000000000" })).toBeNull();
  });
});
