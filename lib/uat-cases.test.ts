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
// this branch removes — unlike grepping for the removed value itself,
// which would plant most of it in a brand-new file on a public repo just
// to prove it's gone.
//
// Also matches the SAME identifier falling back to a literal via `??`/`||`
// (`process.env.X ?? "literal"`), because that's the exact shape the value
// this repo removed actually lived in — a first pass here only matched a
// direct assignment and would have missed it (DevSecOps retro-test).
//
// The fallback operator can be on its own line (no prettier in this repo,
// so that style is writable today) — bounded on `;` rather than `\n` so a
// line break before `??`/`||` doesn't escape the match; still stops at the
// end of the statement, not just the end of the line (DevLead retro-test).
//
// `;` alone isn't enough to bound the window, though: this repo has no
// `prettier` and no `semi` lint rule, so a statement can legally end without
// one — meaning the window can run PAST an unrelated statement into the
// next one and misattribute its literal to an earlier password-like
// identifier (e.g. `const password = compute()\nconst label = a ||
// "Password";` would wrongly flag `password`). Excluding `{`/`}` from the
// window and refusing to cross a statement keyword closes that: braces
// bound a block/object literal, and the keyword list bounds a bare
// (semicolon-less) statement the same way a `;` would (DevSecOps retro-test).
const STATEMENT_KEYWORDS = "const|let|var|function|class|return|import|export|if|for|while|switch|throw";
function literalCredentialAssignments(source: string): string[] {
  const re = new RegExp(
    `\\b(\\w*(?:password|secret|token)\\w*)\\s*[:=]\\s*(?:(?:(?!\\b(?:${STATEMENT_KEYWORDS})\\b)[^;{}])*?(?:\\?\\?|\\|\\|)\\s*)?["'\`]`,
    "gi",
  );
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

describe("literalCredentialAssignments — each form it has to catch, and each it shouldn't", () => {
  it("catches a plain literal assignment", () => {
    expect(literalCredentialAssignments('const SEED_PASSWORD = "placeholder";')).toEqual(["SEED_PASSWORD"]);
  });

  it("catches a ?? fallback to a literal — the exact shape the removed value lived in", () => {
    expect(literalCredentialAssignments('const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "placeholder";')).toEqual(["SEED_PASSWORD"]);
  });

  it("catches a || fallback to a literal", () => {
    expect(literalCredentialAssignments('const SEED_PASSWORD = process.env.SEED_PASSWORD || "placeholder";')).toEqual(["SEED_PASSWORD"]);
  });

  it("catches a ?? fallback whose operator sits on its own line", () => {
    expect(
      literalCredentialAssignments('const SEED_PASSWORD =\n  process.env.SEED_PASSWORD\n  ?? "placeholder";'),
    ).toEqual(["SEED_PASSWORD"]);
  });

  it("does not flag a bare env reference with no literal fallback", () => {
    expect(literalCredentialAssignments("const SEED_PASSWORD = process.env.SEED_PASSWORD;")).toEqual([]);
  });

  it("does not flag a function call", () => {
    expect(literalCredentialAssignments("const SEED_PASSWORD = deriveSecret();")).toEqual([]);
  });

  it("still catches the known identifier-driven UI case", () => {
    expect(literalCredentialAssignments('const passwordLabel = t("k") || "Password";')).toEqual(["passwordLabel"]);
  });

  describe("does not cross a statement boundary when a statement has no trailing semicolon", () => {
    it("a later statement's || literal is not attributed to an earlier bare-call assignment", () => {
      expect(literalCredentialAssignments('const password = compute()\nconst label = a || "Password";')).toEqual([]);
    });

    it("a later statement's ?? literal is not attributed to an earlier bare-call assignment", () => {
      expect(literalCredentialAssignments('const apiToken = getToken()\nconst greeting = name ?? "friend";')).toEqual([]);
    });

    it("a comment between the two statements doesn't change the result", () => {
      expect(literalCredentialAssignments('let secret = load()\n// unrelated\nconst msg = x || "hello";')).toEqual([]);
    });

    it("a literal inside a later function body is not attributed to an earlier bare-call assignment", () => {
      expect(literalCredentialAssignments('const tokenStore = init()\nfunction f() { return y || "z"; }')).toEqual([]);
    });
  });
});
