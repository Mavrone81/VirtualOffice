import { describe, it, expect } from "vitest";
import { AppRole } from "@prisma/client";
import { portalNav } from "./nav";

// A9 DevLead review: nav.ts used to keep its own stale copy of RECRUITER_ROLES,
// so a Sales Assistant Manager still saw "Direct recruits" after the rule
// changed. It now imports RECRUITER_ROLES from lib/roles.ts (the single,
// Prisma-free source lib/rbac.ts's canRecruit also re-exports) — this test
// pins the menu to that source instead of a second hardcoded list.

// Same visibility predicate as components/shell/sidebar.tsx's `visible`.
function isVisible(item: { roles?: AppRole[] }, role: AppRole): boolean {
  return !item.roles || item.roles.includes(role);
}

function findByLabel(labelKey: string) {
  for (const group of portalNav) {
    for (const item of group.items) {
      if (item.labelKey === labelKey) return item;
      const child = item.children?.find((c) => c.labelKey === labelKey);
      if (child) return child;
    }
  }
  throw new Error(`nav item not found: ${labelKey}`);
}

describe("portalNav directRecruits — follows canRecruit (A9: Manager and above)", () => {
  const directRecruits = findByLabel("directRecruits");

  it("is hidden from a Sales Assistant Manager", () => {
    expect(isVisible(directRecruits, AppRole.SalesAssistantManager)).toBe(false);
  });

  it("is hidden from a Sales Associate", () => {
    expect(isVisible(directRecruits, AppRole.SalesAssociate)).toBe(false);
  });

  it("is visible to Sales Manager, Sales Director and Business Admin", () => {
    for (const r of [AppRole.SalesManager, AppRole.SalesDirector, AppRole.Admin]) {
      expect(isVisible(directRecruits, r)).toBe(true);
    }
  });
});
