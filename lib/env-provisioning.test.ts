import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkEnvExample, parseDotenv, unsatisfiedNames } from "./env-example-check";

// Guards the relationship between the environment CONTRACT (lib/env-schema.ts) and the
// TEMPLATE a newcomer copies (.env.example). Two separate provisioning mistakes in one evening
// both produced the same misleading shape — most test files collecting 0 tests behind a summary
// line that read like a small number of ordinary failures — so the pairing is worth asserting.
//
// This file imports lib/env-example-check.ts, which imports lib/env-schema.ts. Neither has an
// import-time side effect. It must never import lib/env.ts, which validates process.env and
// throws: a check that cannot load when the environment is broken is useless exactly then.

const EXAMPLE = readFileSync(join(process.cwd(), ".env.example"), "utf8");

/** The variables a fresh copy of .env.example is EXPECTED to leave for the developer.
 *  Both are deliberate and neither may be "fixed" by editing the template:
 *   - AUTH_SECRET is commented out so a copied .env fails closed rather than booting with a
 *     publicly-known secret;
 *   - PII_ENCRYPTION_KEY carries a visible "change-me" placeholder that is intentionally too
 *     short to satisfy the 64-character minimum.
 *  Asserting the EXACT set is what makes this two-directional — see the tests below. */
const EXPECTED_BLANK = ["AUTH_SECRET", "PII_ENCRYPTION_KEY"];

describe(".env.example matches the environment contract", () => {
  test("NOT VACUOUS: the template parses a non-trivial number of keys", () => {
    // A dead parse reports zero unsatisfied variables for the same reason a perfect template
    // does. Without this, every assertion below could pass against an empty string.
    const report = checkEnvExample(EXAMPLE);
    expect(report.bytesRead).toBeGreaterThan(500);
    expect(report.parsedKeys.length).toBeGreaterThan(0);
    expect(report.commentedKeys.length).toBeGreaterThan(0);
    expect(report.commentedKeys).toContain("AUTH_SECRET");
  });

  test("a commented-out key counts as ABSENT, not as supplied", () => {
    // The whole fail-closed design rests on this, so it is asserted rather than assumed.
    expect(Object.keys(parseDotenv(EXAMPLE))).not.toContain("AUTH_SECRET");
    expect(parseDotenv("# FOO=bar\nBAZ=qux\n")).toEqual({ BAZ: "qux" });
  });

  test("exactly the two deliberately-blank secrets are unsatisfied — no more, no fewer", () => {
    // DIRECTION 1 (a grows): a newly-required variable that nobody documented in .env.example
    // would appear here, and a newcomer would hit it as a confusing test result instead.
    // DIRECTION 2 (set shrinks): if someone "completes" the template by uncommenting the
    // session secret or lengthening the encryption placeholder, this fails too — that is a
    // security regression, not a fix, and it is the easier of the two mistakes to make.
    expect(unsatisfiedNames(EXAMPLE)).toEqual(EXPECTED_BLANK);
  });

  test("every variable the contract requires is at least DOCUMENTED in the template", () => {
    // Being commented out is fine; being absent entirely is not — an undocumented required
    // variable is the trap, because nothing tells the reader it exists.
    const report = checkEnvExample(EXAMPLE);
    const documented = new Set([...report.parsedKeys, ...report.commentedKeys]);
    for (const name of unsatisfiedNames(EXAMPLE)) {
      expect(documented.has(name), `${name} is required but not documented in .env.example`).toBe(true);
    }
  });

  test("the encryption-key placeholder is visibly short, and the comment states the minimum", () => {
    // If the placeholder were a valid-length dummy it would boot, and a publicly-known key
    // would be in use. Short-and-obvious is the intended design; the stated minimum is what
    // turns "subtly wrong" into "visibly wrong".
    const placeholder = /PII_ENCRYPTION_KEY="([^"]*)"/.exec(EXAMPLE)?.[1] ?? "";
    expect(placeholder.length).toBeGreaterThan(0);
    expect(placeholder.length).toBeLessThan(64);
    expect(EXAMPLE).toMatch(/min 64|64 hex characters/);
  });
});
