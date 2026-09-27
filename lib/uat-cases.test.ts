import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import * as uatCases from "./uat-cases";

const root = (p: string) => join(process.cwd(), p);

// Matches `someIdentifier = "..."` / `someKey: "..."` where the identifier
// contains password/secret/token and the right-hand side is a string
// literal — not a reference like `process.env.X` or `seedGuardError(...)`.
// That shape is exactly what a hardcoded credential looks like in source;
// asserting it never appears catches the NEXT one too, not just the value
// this branch removes (DevLead review, 2026-09-27) — unlike grepping for
// the removed value itself, which would plant most of it in a brand-new
// file on a public repo just to prove it's gone.
function literalCredentialAssignments(source: string): string[] {
  const re = /\b(\w*(?:password|secret|token)\w*)\s*[:=]\s*["'`]/gi;
  return [...source.matchAll(re)].map((m) => m[1]);
}

describe("UAT surfaces carry no password literal", () => {
  it("lib/uat-cases.ts exports no password constant", () => {
    expect("UAT_PASSWORD" in uatCases).toBe(false);
  });

  it("app/uat/uat-runner.tsx does not reference a UAT_PASSWORD import", () => {
    const source = readFileSync(root("app/uat/uat-runner.tsx"), "utf8");
    expect(source).not.toContain("UAT_PASSWORD");
  });

  it("prisma/seed.ts assigns no string literal to a password/secret/token-like identifier", () => {
    const source = readFileSync(root("prisma/seed.ts"), "utf8");
    expect(literalCredentialAssignments(source)).toEqual([]);
  });

  it("lib/uat-cases.ts assigns no string literal to a password/secret/token-like identifier", () => {
    const source = readFileSync(root("lib/uat-cases.ts"), "utf8");
    expect(literalCredentialAssignments(source)).toEqual([]);
  });
});
