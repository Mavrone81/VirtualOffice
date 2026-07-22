import { describe, it, expect } from "vitest";
import { teamApprovableCloserIds, directorApprovesCloser } from "./approval-routing";

describe("teamApprovableCloserIds", () => {
  it("collects members across the director's teams", () => {
    expect(teamApprovableCloserIds([{ memberIds: ["a", "b"] }, { memberIds: ["c"] }]).sort()).toEqual(["a", "b", "c"]);
  });
  it("dedupes a member who is in two of the director's teams", () => {
    expect(teamApprovableCloserIds([{ memberIds: ["a", "b"] }, { memberIds: ["b", "c"] }]).sort()).toEqual(["a", "b", "c"]);
  });
  it("is empty when the director directs no team", () => {
    expect(teamApprovableCloserIds([])).toEqual([]);
  });
});

describe("directorApprovesCloser", () => {
  it("approves a closer who is in a team the director directs", () => {
    expect(directorApprovesCloser([{ memberIds: ["a", "b"] }], "b")).toBe(true);
  });
  it("rejects a closer in none of the director's teams", () => {
    expect(directorApprovesCloser([{ memberIds: ["a"] }], "z")).toBe(false);
  });
});
