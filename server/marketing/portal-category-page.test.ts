import { describe, it, expect, vi, beforeEach } from "vitest";

// Lives under server/ so the vitest include picks it up (page components
// aren't covered directly by the unit project's include glob) — same
// pattern as marketing-routes.test.ts.
//
// PD ruling (regression DevSecOps found in the B-9 carve): the carve's
// page.tsx gated EVERY category, including Customisation, behind
// MARKETING_LIBRARY_ENABLED — but Customisation pre-dates B-9 and served
// this portal with no flag check at all. Every B-9 test passed either way
// because they all exercised the flag-ON path; nothing asserted the
// shipping configuration (flag OFF, the actual default). This file is that
// standing requirement: every flagged change carries at least one test of
// the default-config behaviour of anything that already exists on main.

const state = { flagOn: false, session: { user: { id: "assoc1" } } as unknown };

vi.mock("@/lib/env", () => ({ get env() { return { MARKETING_LIBRARY_ENABLED: state.flagOn }; } }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => state.session) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/server/marketing/list-assets", () => ({ listActiveCollections: vi.fn(async () => []) }));

import PortalMarketingCategoryPage from "@/app/portal/marketing/[category]/page";
import { listActiveCollections } from "@/server/marketing/list-assets";

function renderCategory(slug: string) {
  return PortalMarketingCategoryPage({ params: Promise.resolve({ category: slug }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.flagOn = false;
  state.session = { user: { id: "assoc1" } };
});

describe("shipping configuration (MARKETING_LIBRARY_ENABLED=false, the actual default)", () => {
  it("Customisation renders (not notFound) — pre-dates B-9, must work exactly as it did before", async () => {
    await expect(renderCategory("customisation")).resolves.toBeTruthy();
    expect(listActiveCollections).toHaveBeenCalledWith("Customisation");
  });

  it("a new B-9 category (flyers) 404s — the flag must still gate the surface it actually governs", async () => {
    await expect(renderCategory("flyers")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listActiveCollections).not.toHaveBeenCalled();
  });

  it("the other two new B-9 categories (edms, greetings) 404 too", async () => {
    await expect(renderCategory("edms")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderCategory("greetings")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // The third required assertion — "the nav still shows the Customisation
  // link, with its href intact" — lives in lib/nav.test.ts ("portalNav
  // chineseNameMenu — wired unconditionally..."), since that's static data
  // with no flag dependency to thread through here.
});

describe("flag ON: unchanged from the B-9 carve's own coverage, re-asserted here for the same component", () => {
  it("Customisation still renders", async () => {
    state.flagOn = true;
    await expect(renderCategory("customisation")).resolves.toBeTruthy();
  });

  it("a new B-9 category renders once the flag is on", async () => {
    state.flagOn = true;
    await expect(renderCategory("flyers")).resolves.toBeTruthy();
    expect(listActiveCollections).toHaveBeenCalledWith("Flyers");
  });
});

describe("unaffected cases (same both flag states)", () => {
  it("an unknown slug 404s", async () => {
    await expect(renderCategory("not-a-real-category")).rejects.toThrow("NEXT_NOT_FOUND");
    state.flagOn = true;
    await expect(renderCategory("not-a-real-category")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a signed-out visitor 404s even for Customisation", async () => {
    state.session = null;
    await expect(renderCategory("customisation")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
