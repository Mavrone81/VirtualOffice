import { describe, it, expect } from "vitest";
import { AppRole } from "@prisma/client";
import { Image } from "lucide-react";
import { adminNav, portalNav, MARKETING_LIBRARY_NAV_SLUG, withMarketingLibraryHref, myQuotationsVisible, type NavItem } from "./nav";
import { MARKETING_SLUGS } from "./marketing-categories";

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

// A-17 live-path finding: /portal/quotations carries real close-out actions
// for an in-flight Legacy sale but had no nav entry at all. Fail-closed,
// per-associate, same firing-control shape as C-6's quotationRequest pair —
// the ON case must assert PRESENCE on the identical selector the OFF case
// asserts ABSENT, not two absence checks that happen to look like a pair.
describe("portalNav myQuotations — fail-closed on hasInFlightLegacyQuotation (A-17 live-path fix)", () => {
  const myQuotations = findByLabel("myQuotations");

  it("has a real, static href regardless — only VISIBILITY is gated, not the link itself", () => {
    expect(myQuotations.href).toBe("/portal/quotations");
  });

  it("is hidden — not merely empty — when the associate has no in-flight Legacy quotation", () => {
    expect(myQuotationsVisible(myQuotations, false)).toBe(false);
  });

  it("is visible when the associate has one", () => {
    expect(myQuotationsVisible(myQuotations, true)).toBe(true);
  });

  it("never affects an unrelated item, in either state", () => {
    const other = findByLabel("transactionSubmission");
    expect(myQuotationsVisible(other, false)).toBe(true);
    expect(myQuotationsVisible(other, true)).toBe(true);
  });
});

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

// PD ruling (regression DevSecOps found in the carve): Customisation
// pre-dates B-9 and served this portal with NO flag check — the shipping
// configuration (flag off) must keep that link working exactly as before.
// So unlike flyers/edm/greetings, this item carries its real, permanent
// href directly in the static data — no sidebar fill-in, no flag involved.
describe("portalNav chineseNameMenu — wired unconditionally, unlike its flyers/edm/greetings siblings", () => {
  const chineseNameMenu = findByLabel("chineseNameMenu");

  it("has its real href regardless of the flag (pre-dates B-9)", () => {
    expect(chineseNameMenu.href).toBe("/portal/marketing/customisation");
  });
});

// The marketing-library items that DON'T pre-date B-9 had no href on either
// nav, flag on or off — flagged during B-9 review as a wider gap and picked
// up here. This covers the "wired" half: MARKETING_LIBRARY_NAV_SLUG has to
// name a real item on both navs, its slugs have to match
// lib/marketing-categories.ts (a typo here — "edm" instead of "edms" —
// would silently 404 every link), and withMarketingLibraryHref (what the
// sidebar actually calls) has to turn that into the right
// /[area]/marketing/<slug> route, only when unset, only when the flag is on.
describe("MARKETING_LIBRARY_NAV_SLUG — every unwired marketing item resolves to a real category", () => {
  // chineseNameMenu deliberately excluded — it is never unwired (see above).
  const unwiredMarketingLabels = ["flyers", "edm", "customisation", "greetings"];

  it.each(unwiredMarketingLabels)("%s has an entry", (labelKey) => {
    expect(MARKETING_LIBRARY_NAV_SLUG[labelKey]).toBeDefined();
  });

  it("chineseNameMenu has NO entry — it must never go through the flag-fill path", () => {
    expect(MARKETING_LIBRARY_NAV_SLUG.chineseNameMenu).toBeUndefined();
  });

  it("every mapped slug is a real marketing category slug", () => {
    for (const slug of Object.values(MARKETING_LIBRARY_NAV_SLUG)) {
      expect(Object.keys(MARKETING_SLUGS)).toContain(slug);
    }
  });

  it("adminNav's unwired marketing items are exactly the mapped admin labels", () => {
    const marketingGroup = adminNav.find((g) => g.titleKey === "groupMarketing")!;
    const unwired = marketingGroup.items[0].children!.filter((c) => !c.href).map((c) => c.labelKey);
    expect(unwired.sort()).toEqual(["customisation", "edm", "flyers", "greetings"].sort());
  });

  it("portalNav's unwired marketing items are exactly the mapped portal labels — chineseNameMenu is wired, so it's NOT in this set", () => {
    const marketingGroup = portalNav.find((g) => g.titleKey === "groupMarketing")!;
    const unwired = marketingGroup.items[0].children!.filter((c) => !c.href).map((c) => c.labelKey);
    expect(unwired.sort()).toEqual(["edm", "flyers", "greetings"].sort());
  });
});

describe("withMarketingLibraryHref", () => {
  const flyers: NavItem = { labelKey: "flyers", icon: Image };

  it("fills in the href when the flag is on", () => {
    expect(withMarketingLibraryHref(flyers, "admin", true).href).toBe("/admin/marketing/flyers");
    expect(withMarketingLibraryHref(flyers, "portal", true).href).toBe("/portal/marketing/flyers");
  });

  it("leaves href undefined when the flag is off", () => {
    expect(withMarketingLibraryHref(flyers, "portal", false).href).toBeUndefined();
  });

  it("uses the plural slug for edm — a mismatch here would 404 every click", () => {
    const edm: NavItem = { labelKey: "edm", icon: flyers.icon };
    expect(withMarketingLibraryHref(edm, "portal", true).href).toBe("/portal/marketing/edms");
  });

  it("maps admin's customisation to the same category portal's chineseNameMenu already points at", () => {
    const customisation: NavItem = { labelKey: "customisation", icon: flyers.icon };
    expect(withMarketingLibraryHref(customisation, "admin", true).href).toBe("/admin/marketing/customisation");
  });

  it("never touches chineseNameMenu — it has no map entry, flag on or off (pre-dates B-9, always wired)", () => {
    const chineseNameMenu: NavItem = { labelKey: "chineseNameMenu", icon: flyers.icon };
    expect(withMarketingLibraryHref(chineseNameMenu, "portal", true)).toEqual(chineseNameMenu);
    expect(withMarketingLibraryHref(chineseNameMenu, "portal", false)).toEqual(chineseNameMenu);
  });

  it("does not overwrite an item that already has an href, even one the map covers", () => {
    const alreadyWired: NavItem = { labelKey: "flyers", href: "/somewhere-else", icon: flyers.icon };
    expect(withMarketingLibraryHref(alreadyWired, "portal", true).href).toBe("/somewhere-else");
  });

  it("leaves an unrelated item untouched", () => {
    const dashboard: NavItem = { labelKey: "myDashboard", href: "/portal/dashboard", icon: flyers.icon };
    expect(withMarketingLibraryHref(dashboard, "portal", true)).toEqual(dashboard);
  });
});
