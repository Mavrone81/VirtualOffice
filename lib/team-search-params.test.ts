// The live bug this guards against: TEAM_SEARCH_KEY used to be exported
// from components/team/team-search-filter.tsx, a "use client" module. When
// a Server Component page imported it and used it as a computed key
// (`searchParams[TEAM_SEARCH_KEY]`), the RSC client-boundary transform
// replaced the import with an opaque client-reference object instead of the
// real string -- so the lookup was always undefined and the search filter
// silently no-opped. Found live (UIUX driving the actual running app: the
// dropdown showed a selection, the tiles never changed), invisible to every
// test run against the underlying functions directly -- including this
// file's own sibling, lib/team-search.integration.test.ts -- because vitest
// resolves modules with plain Node/ESM and never applies Next's "use
// client" transform: a vitest import of a "use client" file's export
// returns the real value either way, correct or broken. That means this
// class of bug can ONLY be caught structurally (the constant must never
// live in a "use client" file again) or by a true end-to-end test against a
// running Next server (Playwright against `next build`/`next start`) --
// this codebase has no such harness today, and adding one is a separate,
// larger decision than this fix. The two tests below are the honest,
// available form of regression coverage for this specific bug: they can't
// prove the RSC transform behaves correctly, but they can prove the
// precondition that made it fail (the constant living in a client module)
// is no longer true, and stays true if anyone moves it back.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TEAM_SEARCH_KEY } from "./team-search-params";

const THIS_FILE_AS_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "team-search-params.ts");

describe("TEAM_SEARCH_KEY's home module", () => {
  it("has no \"use client\" directive, so a Server Component importing it gets the real value, not a client reference", () => {
    const text = readFileSync(THIS_FILE_AS_SOURCE, "utf8");
    expect(text).not.toMatch(/^\s*["']use client["']/m);
  });

  it("is the real primitive string, not an object (what a correct import actually looks like)", () => {
    expect(typeof TEAM_SEARCH_KEY).toBe("string");
    expect(TEAM_SEARCH_KEY).toBe("teamSearch");
  });
});
