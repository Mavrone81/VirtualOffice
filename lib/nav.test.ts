import { describe, it, expect } from "vitest";
import { AppRole } from "@prisma/client";
import { Image } from "lucide-react";
import { adminNav, portalNav, MARKETING_LIBRARY_NAV_SLUG, withMarketingLibraryHref, myQuotationsVisible, quotationRequestVisible, type NavItem } from "./nav";
import { MARKETING_SLUGS } from "./marketing-categories";
import { canRecruit, isManagerRole } from "./roles";
import { canSetQuota } from "./quota";

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
describe("portalNav quotationRequest — fail-closed on A17_CLOSED_DEAL_FLOW (C-6)", () => {
  const quotationRequest = findByLabel("quotationRequest");

  it("has a real, static href regardless of the flag — only VISIBILITY is gated, not the link itself", () => {
    expect(quotationRequest.href).toBe("/portal/agreements");
  });

  it("is hidden — not merely disabled — when the flag is off", () => {
    expect(quotationRequestVisible(quotationRequest, false)).toBe(false);
  });

  it("is visible when the flag is on", () => {
    expect(quotationRequestVisible(quotationRequest, true)).toBe(true);
  });

  it("never affects an unrelated item, in either flag state — the predicate only ever matches this one labelKey", () => {
    const other = findByLabel("transactionSubmission");
    expect(quotationRequestVisible(other, false)).toBe(true);
    expect(quotationRequestVisible(other, true)).toBe(true);
  });
});

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

// C-8 (owner ruling, 2026-10-03): the two formerly-separate "My Team"
// sections (the open-to-all `groupMyTeamBase` and the DIRECTOR_ROLES-only
// `groupMyTeam`) are now one group. This proves each item's gate against the
// actual predicate, not by re-reading the config and asserting it reads back
// correctly.
//
// Team Dashboard (recruitmentDashboard) stays fully OPEN — an earlier pass
// of this change gated it to MANAGER_ROLES, which was wrong and got caught:
// that would have silently erased A8, a delivered client row (the "not
// eligible for recruitment yet" state the page shows a non-recruiter
// instead of the roster). Team Sales / Team Commissions DO move from the
// old nav's DIRECTOR_ROLES to MANAGER_ROLES, matching each page's own
// explicit isManagerRole check (moved there from the shared layout, so
// relaxing the dashboard's gate can't relax theirs). Split Approvals and
// Invite Candidate are unaffected — their nav gate already matched their
// route. See the block comment in lib/nav.ts for the full reasoning.
describe("portalNav My Team unification (C-8) — one group, order locked, per-item gating unchanged", () => {
  it("groupMyTeam no longer exists as its own section — there is exactly one My Team group", () => {
    const myTeamGroups = portalNav.filter((g) => g.titleKey === "groupMyTeam" || g.titleKey === "groupMyTeamBase");
    expect(myTeamGroups).toHaveLength(1);
    expect(myTeamGroups[0].titleKey).toBe("groupMyTeamBase");
  });

  it("teamOverview is gone — folded into the Team Dashboard item, not carried over as its own entry", () => {
    expect(() => findByLabel("teamOverview")).toThrow();
  });

  it("locked order (owner-confirmed): Team Dashboard, Team Performance, Split Approvals, Invite Candidate, Team Sales, Team Commissions", () => {
    const group = portalNav.find((g) => g.titleKey === "groupMyTeamBase")!;
    const children = group.items[0].children!;
    expect(children.map((c) => c.labelKey)).toEqual([
      "recruitmentDashboard",
      "downlinePerformance",
      "splitApprovals",
      "directRecruits",
      "teamSales",
      "teamCommissions",
    ]);
  });

  it("Team Dashboard now points at the merged page, /portal/team (not the retired /portal/recruitment/associates)", () => {
    expect(findByLabel("recruitmentDashboard").href).toBe("/portal/team");
  });

  // Final gate, per item. Every role below is checked against every item, so
  // a widened OR narrowed gate on any single item fails here, not just the
  // ones that moved.
  const ALL_ROLES: AppRole[] = ["SalesAssociate", "SalesAssistantManager", "SalesManager", "SalesDirector", "Admin"];
  const expectedVisible: Record<string, AppRole[]> = {
    recruitmentDashboard: ALL_ROLES,
    downlinePerformance: ALL_ROLES,
    directRecruits: ["SalesManager", "SalesDirector", "Admin"],
    splitApprovals: ["SalesDirector", "Admin"],
    teamSales: ["SalesAssistantManager", "SalesManager", "SalesDirector"],
    teamCommissions: ["SalesAssistantManager", "SalesManager", "SalesDirector"],
  };

  for (const [labelKey, visibleTo] of Object.entries(expectedVisible)) {
    describe(labelKey, () => {
      for (const role of ALL_ROLES) {
        const shouldSee = visibleTo.includes(role);
        it(`is ${shouldSee ? "visible" : "hidden"} for ${role} — unchanged from before the merge`, () => {
          expect(isVisible(findByLabel(labelKey), role)).toBe(shouldSee);
        });
      }
    });
  }

  // PD (2026-10-03): a proof that only checks a Director and a plain
  // Associate passes even if the merge breaks a Sales Assistant Manager
  // either way, because SAM is the one role where the three authorities
  // genuinely disagree — the nav-level test above can't see this, since
  // none of these three functions are about nav visibility. Checked
  // directly, against each function, not inferred from the nav config.
  describe("SalesAssistantManager — the one role where recruitment, route, and quota authority genuinely disagree", () => {
    it("is NOT a recruiter — gets the \"not eligible\" card, no downline roster (RECRUITER_ROLES excludes SAM)", () => {
      expect(canRecruit("SalesAssistantManager")).toBe(false);
    });

    it("CAN reach the Team Dashboard / Team Sales / Team Commissions route gate (MANAGER_ROLES includes SAM)", () => {
      expect(isManagerRole("SalesAssistantManager")).toBe(true);
    });

    it("CAN set a team member's quota (canSetQuota authority starts at SAM)", () => {
      expect(canSetQuota("SalesAssistantManager")).toBe(true);
    });

    // Contrast: a Sales Manager passes all three (no disagreement to miss),
    // and a plain Associate fails all three (no disagreement either) — SAM
    // is specifically the role that exercises the split.
    it("contrast — SalesManager passes all three authorities", () => {
      expect(canRecruit("SalesManager")).toBe(true);
      expect(isManagerRole("SalesManager")).toBe(true);
      expect(canSetQuota("SalesManager")).toBe(true);
    });

    it("contrast — SalesAssociate fails all three authorities", () => {
      expect(canRecruit("SalesAssociate")).toBe(false);
      expect(isManagerRole("SalesAssociate")).toBe(false);
      expect(canSetQuota("SalesAssociate")).toBe(false);
    });
  });
});
