import { describe, it, expect } from "vitest";
import { canSetQuota, canOverrideQuota } from "./quota";

// 16-Jul §3: quota may be set by SAM/SM/SD/Business Admin; a Director's value
// overrides a Manager's (higher authority can overwrite, lower cannot).
describe("canSetQuota — SAM and above", () => {
  it.each([
    ["Admin", true],
    ["SalesDirector", true],
    ["SalesManager", true],
    ["SalesAssistantManager", true],
    ["SalesAssociate", false],
    ["Accounts", false],
  ] as const)("%s → %s", (role, allowed) => {
    expect(canSetQuota(role)).toBe(allowed);
  });
});

describe("canOverrideQuota — director overrides manager", () => {
  it("a Director can override a Manager's quota", () => {
    expect(canOverrideQuota("SalesManager", "SalesDirector")).toBe(true);
  });
  it("a Manager cannot override a Director's quota", () => {
    expect(canOverrideQuota("SalesDirector", "SalesManager")).toBe(false);
  });
  it("same-tier setters can overwrite each other", () => {
    expect(canOverrideQuota("SalesManager", "SalesManager")).toBe(true);
  });
  it("a Manager overrides an Assistant Manager", () => {
    expect(canOverrideQuota("SalesAssistantManager", "SalesManager")).toBe(true);
  });
  it("Business Admin can override anyone", () => {
    expect(canOverrideQuota("SalesDirector", "Admin")).toBe(true);
  });
});
