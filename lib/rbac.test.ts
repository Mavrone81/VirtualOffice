import { describe, it, expect } from "vitest";
import { AppRole, Designation } from "@prisma/client";
import { can, isFullAdmin, isAdminRole, roleForDesignation, canRecruit, type Capability } from "./rbac";

describe("roleForDesignation — AppRole is derived from the sales designation (16-Jul)", () => {
  it.each([
    [Designation.SalesAssociate, AppRole.SalesAssociate],
    [Designation.SalesAssistantManager, AppRole.SalesAssistantManager],
    [Designation.SalesManager, AppRole.SalesManager],
    [Designation.SalesDirector, AppRole.SalesDirector],
  ])("%s → %s", (d, r) => {
    expect(roleForDesignation(d)).toBe(r);
  });
});

describe("canRecruit — invite candidate is SAM and above", () => {
  it("SAM, SM, SD and Business Admin can recruit", () => {
    for (const r of [AppRole.SalesAssistantManager, AppRole.SalesManager, AppRole.SalesDirector, AppRole.Admin]) {
      expect(canRecruit(r)).toBe(true);
    }
  });
  it("Sales Associate and Accounts cannot recruit", () => {
    expect(canRecruit(AppRole.SalesAssociate)).toBe(false);
    expect(canRecruit(AppRole.Accounts)).toBe(false);
  });
});

// Canonical source: docs/05_RBAC.md §3 permission matrix.
const ADMIN_ONLY: Capability[] = [
  "manage_products",
  "manage_users",
  "manage_companies",
  "manage_others_name_card",
  "manual_commission_override",
];

// Admin-area capabilities Accounts DOES share with Admin (matrix Admin ✅ / Accounts ✅).
const SHARED: Capability[] = []; // (none of the fine-grained caps modelled here are shared; see note below)

describe("isFullAdmin", () => {
  it("is true only for Admin, not Accounts", () => {
    expect(isFullAdmin(AppRole.Admin)).toBe(true);
    expect(isFullAdmin(AppRole.Accounts)).toBe(false);
    expect(isFullAdmin(AppRole.SalesDirector)).toBe(false);
  });
});

describe("isAdminRole (admin-area gate) is unchanged", () => {
  it("still admits both Admin and Accounts to the admin area", () => {
    expect(isAdminRole(AppRole.Admin)).toBe(true);
    expect(isAdminRole(AppRole.Accounts)).toBe(true);
    expect(isAdminRole(AppRole.SalesAssociate)).toBe(false);
  });
});

describe("can() — Admin has every capability", () => {
  it.each([...ADMIN_ONLY, ...SHARED])("Admin can %s", (cap) => {
    expect(can(AppRole.Admin, cap)).toBe(true);
  });
});

describe("can() — Accounts is denied the Admin-only capabilities", () => {
  it.each(ADMIN_ONLY)("Accounts cannot %s", (cap) => {
    expect(can(AppRole.Accounts, cap)).toBe(false);
  });

  // The RBAC test case that pins this split (docs/05_RBAC.md §6).
  it("Accounts cannot submit a manual commission override", () => {
    expect(can(AppRole.Accounts, "manual_commission_override")).toBe(false);
  });
});

describe("can() — portal roles hold none of these admin capabilities", () => {
  const portal = [AppRole.SalesDirector, AppRole.SalesManager, AppRole.SalesAssociate];
  it.each(portal)("%s has no admin capability", (role) => {
    for (const cap of ADMIN_ONLY) expect(can(role, cap)).toBe(false);
  });
});
