import { describe, it, expect } from "vitest";
import { canServeAsset } from "./list-assets";

describe("canServeAsset (ADR-0002 N6)", () => {
  it("serves an active asset in an active collection", () => {
    expect(canServeAsset({ archivedAt: null }, { archivedAt: null })).toBe(true);
  });

  it("refuses an archived asset, even in an active collection", () => {
    expect(canServeAsset({ archivedAt: new Date() }, { archivedAt: null })).toBe(false);
  });

  it("refuses an active asset whose collection is archived", () => {
    expect(canServeAsset({ archivedAt: null }, { archivedAt: new Date() })).toBe(false);
  });

  it("refuses a missing asset or collection", () => {
    expect(canServeAsset(null, { archivedAt: null })).toBe(false);
    expect(canServeAsset({ archivedAt: null }, null)).toBe(false);
  });
});
