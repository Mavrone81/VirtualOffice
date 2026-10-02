// Fonts-matcher hardening (02 Oct 2026): C-1 added public/fonts/alex-brush/
// (self-hosted, SIL OFL) without excluding it from middleware's auth matcher
// -- confirmed live: an anonymous GET of the .ttf 302s to /login, same as any
// other protected path. Nothing currently renders it unauthenticated (the
// name-card studio that uses it is itself behind /portal), so this was
// latent rather than live -- the next render path that doesn't require a
// session would have broken silently (fallback typeface, no error). This
// hardens the matcher before that happens, mirroring the existing `namecard`
// exclusion's own reasoning: a @font-face url() is a same-origin asset GET,
// not a page view.
//
// SEPARATE, pre-existing defect fixed in the same line because it's the same
// line: the exclusions were a bare literal PREFIX match, not anchored to a
// path segment ("/namecardish" or "/fonts-admin" would have been wrongly
// excluded too), and "favicon.ico" had an unescaped "." matching any
// character. Zero exploitable routes today (every app/* route checked) --
// not introduced by the fonts change, found and fixed in passing.
//
// This reads middleware.ts's SOURCE TEXT rather than importing the module.
// Importing it pulls in NextAuth's edge runtime (`NextAuth(authConfig)`),
// which fails to resolve under vitest's node test environment ("Cannot find
// module .../next-auth/.../next/server") -- a real, reproduced failure, not
// a hypothetical. Next.js's own build also needs `config.matcher` to stay a
// plain literal in that file (not re-exported from elsewhere) for its
// route-manifest extraction, so the fix belongs there, unchanged in shape --
// this test verifies the ACTUAL file content instead of a hand-duplicated
// copy that could silently drift from it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readMiddlewareSource(): string {
  return readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
}

function extractMatcherPattern(): string {
  const src = readMiddlewareSource();
  const m = src.match(/matcher:\s*\[\s*("(?:[^"\\]|\\.)*")\s*\]/);
  if (!m) throw new Error("middleware.ts: could not find config.matcher — did its shape change?");
  // m[1] is the raw SOURCE TEXT of the string literal, quotes included, with
  // JS escapes (\\, \.) still literal two-character sequences -- NOT yet the
  // runtime string value. Evaluating it as the JS string-literal expression
  // it actually is (rather than hand-unescaping) is what TypeScript itself
  // does when this file compiles; a regex built straight from the raw text
  // instead would see a doubled backslash as "match one literal backslash"
  // rather than "escaped dot", silently testing the wrong pattern. Safe here
  // because the input is this repo's own middleware.ts, not untrusted data.
  return eval(m[1]);
}

function matcherRegex(): RegExp {
  return new RegExp("^" + extractMatcherPattern() + "$");
}

describe("middleware matcher (read from middleware.ts's own source)", () => {
  it("the extracted pattern literally contains \"fonts\" as one of the excluded alternatives", () => {
    // A string-contains check first, independent of the regex test below --
    // if this fails, the regex tests below are checking the wrong thing.
    expect(extractMatcherPattern()).toContain("fonts");
  });

  it("CAVEAT MADE FALSIFIABLE -- config.matcher has no has/missing clause, matching the comment's own claim about \\?'s boundary", () => {
    // The comment at middleware.ts's matcher line says query IS relevant to
    // a `has`/`missing` clause (if one is ever added) even though it never
    // reaches the regexp itself -- a true statement today precisely because
    // no such clause exists. A prose caveat only protects a PR reader who
    // happens to read it; this makes the premise itself checked, so adding
    // a has/missing clause without revisiting the comment fails THIS test
    // and points here, not just at a comment nobody re-reads.
    //
    // Scoped to the matcher array's OWN source span (from "matcher:" to its
    // balanced closing "]"), not the whole file -- a bare substring search
    // for "has:"/"missing:" across all of middleware.ts would also fire on
    // unrelated code (e.g. a future `hasRole:` identifier elsewhere would be
    // a false positive outside this scope). Scanned by bracket DEPTH, not a
    // regex assuming either a single-line or multi-line array -- a
    // has/missing clause's own value is itself an array
    // (`has: [{type: "header", ...}]`), so the matcher array can contain
    // nested "[...]" once one exists, which a non-greedy "find the next ]"
    // regex would stop at too early.
    const src = readMiddlewareSource();
    const start = src.indexOf("matcher:");
    if (start === -1) throw new Error("middleware.ts: could not find \"matcher:\" at all — did its shape change?");
    const openBracket = src.indexOf("[", start);
    if (openBracket === -1) throw new Error("middleware.ts: \"matcher:\" found but no \"[\" after it — did its shape change?");
    let depth = 0;
    let closeBracket = -1;
    for (let i = openBracket; i < src.length; i++) {
      if (src[i] === "[") depth++;
      else if (src[i] === "]") {
        depth--;
        if (depth === 0) {
          closeBracket = i;
          break;
        }
      }
    }
    if (closeBracket === -1) throw new Error("middleware.ts: unbalanced brackets in config.matcher — did its shape change?");
    const matcherSpan = src.slice(start, closeBracket + 1);

    // Assert the extraction itself worked BEFORE asserting absence -- a
    // span that's empty, or isn't really the matcher (e.g. a regex that
    // silently stopped matching early), would make "0 occurrences" true
    // for the wrong reason: nothing to search, not nothing found. A
    // negative assertion is only as good as its proof the search actually
    // ran over real content.
    expect(matcherSpan.length).toBeGreaterThan(50); // the real span is ~94 chars; a near-empty one is a broken extraction, not a clean matcher
    expect(matcherSpan).toContain("matcher:");
    expect(matcherSpan).toContain("fonts"); // confirms this IS the fonts-exclusion matcher, not some other array

    // Count occurrences, not just match/no-match -- report what was
    // actually inspected rather than a bare boolean.
    const hasCount = (matcherSpan.match(/\bhas\s*:/g) ?? []).length;
    const missingCount = (matcherSpan.match(/\bmissing\s*:/g) ?? []).length;
    expect(hasCount, `expected 0 "has:" occurrences in the ${matcherSpan.length}-char matcher span, found ${hasCount}`).toBe(0);
    expect(missingCount, `expected 0 "missing:" occurrences in the ${matcherSpan.length}-char matcher span, found ${missingCount}`).toBe(0);
  });

  it("public/fonts/** is excluded (middleware does NOT run, no auth gate)", () => {
    const re = matcherRegex();
    expect(re.test("/fonts/alex-brush/AlexBrush-Regular.ttf")).toBe(false);
    expect(re.test("/fonts/some-other-family/Regular.woff2")).toBe(false);
    expect(re.test("/fonts")).toBe(false); // the bare segment itself, no trailing slash
  });

  it("CONTROL -- a real protected page still matches (middleware DOES run, still gated)", () => {
    const re = matcherRegex();
    expect(re.test("/portal/dashboard")).toBe(true);
    expect(re.test("/admin/associates")).toBe(true);
  });

  it("the pre-existing exclusions (namecard, api, _next static+image, favicon) still work", () => {
    const re = matcherRegex();
    expect(re.test("/namecard/logo.png")).toBe(false);
    expect(re.test("/api/something")).toBe(false);
    expect(re.test("/_next/static/chunk.js")).toBe(false);
    expect(re.test("/favicon.ico")).toBe(false);
  });

  it("Next's image optimiser stays excluded, under BOTH possible readings of what the matcher sees", () => {
    // /_next/image is invoked as /_next/image?url=…&w=…&q=… -- but Next's
    // own matcher (node_modules/next/dist/shared/lib/router/utils/
    // middleware-route-matcher.js: `.exec(pathname)`) runs the REGEXP
    // against the pathname ALONE; the query string is passed into the
    // surrounding matcher function (used for has/missing conditions) but
    // never reaches the regexp itself. So in practice
    // this only ever needs to match "/_next/image" (via the boundary's "$"
    // branch) -- a naive (?:/|$) boundary was never actually broken here,
    // checked against Next's source, not assumed. The "\?" branch in the
    // matcher is still there, belt-and-suspenders, so this stays correct
    // even under the (currently false) assumption that a future Next
    // version matches against the full URL -- asserting the WITH-query-
    // string case too documents that, rather than asserting only the case
    // that was ever actually exercised.
    const re = matcherRegex();
    expect(re.test("/_next/image")).toBe(false); // what Next's matcher actually sees
    expect(re.test("/_next/image?url=x")).toBe(false); // belt-and-suspenders, not load-bearing
  });

  it("segment-anchoring fix: a path merely PREFIXED by an excluded name, not matching it as a whole segment, now stays correctly gated", () => {
    // Before the fix, these were wrongly excluded (any of "api", "_next/...",
    // "favicon.ico", "namecard", "fonts" being a literal string-prefix was
    // enough). The CONTROL test below proves the pre-fix pattern really did
    // get these wrong, so this isn't asserting something that was already
    // true.
    const re = matcherRegex();
    expect(re.test("/fontsize")).toBe(true);
    expect(re.test("/fonts-admin")).toBe(true);
    expect(re.test("/myfonts/x")).toBe(true);
    expect(re.test("/namecardish")).toBe(true);
    expect(re.test("/api-admin")).toBe(true);
  });

  it("NEGATIVE -- sibling prefixes of \"fonts\" are not accidentally excluded: /fontsy, /fonts-admin, /myfonts all stay gated", () => {
    const re = matcherRegex();
    expect(re.test("/fontsy")).toBe(true);
    expect(re.test("/fonts-admin")).toBe(true);
    expect(re.test("/myfonts")).toBe(true);
  });

  it("escaped-dot fix: favicon.ico's \".\" no longer matches any character", () => {
    const re = matcherRegex();
    expect(re.test("/faviconXico")).toBe(true); // was wrongly excluded pre-fix (unescaped ".")
  });

  it("CONTROL -- reverting to the ORIGINAL (truly pre-fix) pattern makes the font exclusion fail", () => {
    // Proves this suite would have caught the original font bug: before
    // today, "fonts" wasn't in the exclusion list at all, so this pattern
    // doesn't have the segment-anchoring defect either (nothing excluded
    // "fonts*" by any method) -- it fails ONLY on the font assertion.
    const trulyOriginalPattern = "/((?!api|_next/static|_next/image|favicon.ico|namecard).*)";
    const re = new RegExp("^" + trulyOriginalPattern + "$");
    expect(re.test("/fonts/alex-brush/AlexBrush-Regular.ttf")).toBe(true); // gated -- the font bug
  });

  it("CONTROL -- reverting ONLY the segment-anchoring (fonts excluded, but as a bare prefix like the rest of the list) makes the prefix-match defect fail", () => {
    // Adding "fonts" to the SAME unanchored list the other exclusions
    // already used is a plausible but incomplete fix: it correctly excludes
    // the real font path, which is why a test of ONLY that path wouldn't
    // catch the prefix-anchoring defect -- that defect needs its own case,
    // which is the point of this control existing separately from the one
    // above.
    const unanchoredFontsPattern = "/((?!api|_next/static|_next/image|favicon.ico|namecard|fonts).*)";
    const re = new RegExp("^" + unanchoredFontsPattern + "$");
    expect(re.test("/fonts/alex-brush/AlexBrush-Regular.ttf")).toBe(false); // correctly excluded even here
    expect(re.test("/fontsize")).toBe(false); // wrongly ALSO excluded -- the defect this control catches
    expect(re.test("/faviconXico")).toBe(false); // wrongly excluded -- the pre-existing unescaped-dot bug
  });
});
