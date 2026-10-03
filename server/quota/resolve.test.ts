import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const spies = vi.hoisted(() => ({
  quotaRows: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
  teamRows: vi.fn<(args?: unknown) => Promise<unknown[]>>(async () => []),
}));
vi.mock("@/lib/db", () => ({
  prisma: { salesQuota: { findMany: spies.quotaRows }, team: { findMany: spies.teamRows } },
}));

import { resolveTargetsFor } from "./resolve";

const NOW = new Date(2026, 9, 15); // 2026-10 / 2026
const D = (v: string) => new Prisma.Decimal(v);
const teamRow = (members: string[], quotas: { periodType: "Monthly" | "Yearly"; amount: string }[], directorId: string | null = null) => ({
  directorId,
  members: members.map((associateId) => ({ associateId })),
  quotas: quotas.map((q) => ({ periodType: q.periodType, amount: D(q.amount) })),
});

beforeEach(() => {
  spies.quotaRows.mockReset().mockResolvedValue([]);
  spies.teamRows.mockReset().mockResolvedValue([]);
});

describe("resolveTargetsFor — individual override, else team, else none", () => {
  it("team target only: both associates inherit it (2 associates, 0 override rows, 1 team row)", async () => {
    const overrides: unknown[] = [];
    const teams = [teamRow(["A", "B"], [{ periodType: "Monthly", amount: "5000.00" }, { periodType: "Yearly", amount: "60000.00" }])];
    spies.quotaRows.mockResolvedValue(overrides);
    spies.teamRows.mockResolvedValue(teams);
    const out = await resolveTargetsFor(["A", "B"], NOW);
    expect([overrides.length, teams.length, out.size]).toEqual([0, 1, 2]);
    for (const id of ["A", "B"]) {
      expect(out.get(id)?.month).toEqual({ amount: "5000", source: "team" });
      expect(out.get(id)?.year).toEqual({ amount: "60000", source: "team" });
    }
  });

  it("individual override present wins over the team figure, for that associate only (2 associates, 1 override row, 1 team row)", async () => {
    const overrides = [{ associateId: "A", month: "2026-10", amount: D("8000.00") }];
    const teams = [teamRow(["A", "B"], [{ periodType: "Monthly", amount: "5000.00" }])];
    spies.quotaRows.mockResolvedValue(overrides);
    spies.teamRows.mockResolvedValue(teams);
    const out = await resolveTargetsFor(["A", "B"], NOW);
    expect([overrides.length, teams.length, out.size]).toEqual([1, 1, 2]);
    expect(out.get("A")?.month).toEqual({ amount: "8000", source: "individual" });
    expect(out.get("B")?.month).toEqual({ amount: "5000", source: "team" });
  });

  it("a monthly override does not leak into the yearly slot (1 override row, 1 team row)", async () => {
    spies.quotaRows.mockResolvedValue([{ associateId: "A", month: "2026-10", amount: D("8000") }]);
    spies.teamRows.mockResolvedValue([teamRow(["A"], [{ periodType: "Yearly", amount: "60000" }])]);
    const out = await resolveTargetsFor(["A"], NOW);
    expect(out.get("A")?.month?.source).toBe("individual");
    expect(out.get("A")?.year).toEqual({ amount: "60000", source: "team" });
  });

  it("neither set: null for month and year, not a zero (1 associate, 0 override rows, 0 team rows)", async () => {
    const out = await resolveTargetsFor(["A"], NOW);
    expect(out.size).toBe(1);
    expect(out.get("A")).toEqual({ month: null, year: null });
  });

  it("an associate in a team with no target for the period gets null (1 associate, 1 team row, 0 quota rows)", async () => {
    spies.teamRows.mockResolvedValue([teamRow(["A"], [])]);
    const out = await resolveTargetsFor(["A"], NOW);
    expect(out.get("A")).toEqual({ month: null, year: null });
  });

  it("an associate outside every returned team does not inherit another team's target (2 associates, 1 team row)", async () => {
    spies.teamRows.mockResolvedValue([teamRow(["A"], [{ periodType: "Monthly", amount: "5000" }])]);
    const out = await resolveTargetsFor(["A", "Z"], NOW);
    expect(out.get("A")?.month?.source).toBe("team");
    expect(out.get("Z")?.month).toBeNull();
  });

  it("a team director inherits the team target (1 team row, director not a TeamMember)", async () => {
    spies.teamRows.mockResolvedValue([teamRow([], [{ periodType: "Yearly", amount: "70000" }], "D")]);
    const out = await resolveTargetsFor(["D"], NOW);
    expect(out.get("D")?.year).toEqual({ amount: "70000", source: "team" });
  });

  it("queries ask for the current month + year, active teams only", async () => {
    await resolveTargetsFor(["A"], NOW);
    expect(JSON.stringify(spies.quotaRows.mock.calls[0][0])).toContain("2026-10");
    const teamWhere = JSON.stringify(spies.teamRows.mock.calls[0][0]);
    expect(teamWhere).toContain('"active":true');
    expect(teamWhere).toContain('"period":"2026-10"');
    expect(teamWhere).toContain('"period":"2026"');
  });

  it("empty input runs no query and returns an empty map", async () => {
    expect((await resolveTargetsFor([], NOW)).size).toBe(0);
    expect(spies.quotaRows).not.toHaveBeenCalled();
    expect(spies.teamRows).not.toHaveBeenCalled();
  });
});
