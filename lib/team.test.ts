import { describe, it, expect } from "vitest";
import { resolveTeamScope } from "./team";

// 16-Jul #7: team aggregates read explicit Team membership. Until a manager has
// an explicit team, we fall back to their upline downline so views don't blank.
describe("resolveTeamScope", () => {
  it("falls back to the downline when the associate has no team", () => {
    expect(resolveTeamScope({ self: "me", teams: [], downline: ["me", "a", "b"] })).toEqual(["me", "a", "b"]);
  });

  it("uses explicit team members (plus self) when a team exists", () => {
    const r = resolveTeamScope({ self: "me", teams: [{ members: ["a", "b"] }], downline: ["me", "x"] });
    expect(new Set(r)).toEqual(new Set(["me", "a", "b"]));
    expect(r).not.toContain("x"); // ignores the downline once an explicit team exists
  });

  it("unions members across multiple teams and dedupes", () => {
    const r = resolveTeamScope({ self: "me", teams: [{ members: ["a", "b"] }, { members: ["b", "c"] }], downline: [] });
    expect(new Set(r)).toEqual(new Set(["me", "a", "b", "c"]));
    expect(r.length).toBe(4);
  });

  it("never duplicates self when self is also a listed member", () => {
    const r = resolveTeamScope({ self: "me", teams: [{ members: ["me", "a"] }], downline: [] });
    expect(r.filter((x) => x === "me").length).toBe(1);
  });

  it("returns just self for an explicit but empty team (honest, not a downline fallback)", () => {
    expect(resolveTeamScope({ self: "me", teams: [{ members: [] }], downline: ["me", "a"] })).toEqual(["me"]);
  });
});
