import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import en from "@/messages/en.json";
import zhCN from "@/messages/zh-CN.json";

/**
 * Every t()/getTranslations() key literally referenced in source must
 * resolve in BOTH catalogues. Nothing enforced this before: 70 of the 71
 * test files that touch getTranslations mock it as `(k: string) => k`, so
 * an action test compares the key STRING and never opens a catalogue.
 * Only 3 files read the real catalogues (check-duplicate-keys, i18n-parity,
 * rank-band-parity) and none of them asserts a code-referenced key exists.
 * Found this gap live: #42 would have shipped 2 flag-off-reachable actions
 * (verifySale, getVerifyChecklist) looking up a key #43 was about to
 * delete, green the whole way, because nothing resolves keys against code.
 *
 * WHAT THIS EXTRACTOR CAN SEE — a binding of the exact shape
 * `const NAME = (await )?(useTranslations|getTranslations)("namespace")`,
 * then a call `NAME("key")` / `NAME('key')` / NAME(`plain template, no
 * interpolation`) anywhere later in the SAME file. Namespace-less
 * (`useTranslations()`) is handled — the key argument is then the full
 * dotted path from the catalogue root.
 *
 * WHAT IT CANNOT SEE, named rather than silently missed:
 * 1. A key built from a template literal WITH interpolation, e.g.
 *    `t(\`docTemplate.cat.${c}\`)` — which of the interpolated key's
 *    siblings actually gets called depends on a runtime value this static
 *    scan doesn't have. Collected separately as `unresolvable`, logged,
 *    never asserted on. 7 such call sites exist as of this writing (see
 *    the logged list when this test runs) — none of their resolved forms
 *    are checked by this test; they need a value-enumeration test of
 *    their own if that coverage is wanted.
 * 2. A translation-hook binding that ISN'T a plain `const/let NAME =
 *    fn(...)` — most concretely, `const [x, t, y] = await Promise.all([...,
 *    getTranslations("ns"), ...])`, a real pattern in
 *    components/dashboard/profile-band-card.tsx. This extractor does not
 *    special-case array-destructured Promise.all bindings; any t()-calls
 *    made through such a binding are invisible to this test, not merely
 *    unresolvable — they never enter `resolved` OR `unresolvable`. A
 *    dedicated check ("count of tracked hook bindings that this file's
 *    call sites don't refer back to") would be needed to bound this class
 *    rather than just naming the one instance found by hand.
 * 3. A namespace or key built dynamically at the useTranslations/
 *    getTranslations call itself (e.g. a template-literal namespace) —
 *    none exist in the codebase as of this writing (checked separately),
 *    but if one is added this extractor won't bind it and its keys fall
 *    into the same blind spot as #2.
 * 4. The call-site match is `\b<varName>\(` — a plain word-boundary regex,
 *    not a real parser. An unrelated identifier that happens to END in the
 *    exact same letters as a bound variable, immediately followed by "(",
 *    would false-positive as a call through that binding (e.g. a bound
 *    variable named `ts` could in principle collide with a call like
 *    `getResults(` only if "ts(" sat at a word boundary inside it, which
 *    it doesn't for that example — but the risk is structural, not proven
 *    absent for every possible future variable name). Not hit in the
 *    current codebase (checked the bound names that exist today), but a
 *    future short/common variable name bound to a namespace could trigger
 *    it; a real AST parse would close this permanently.
 *
 * REVERSE CHECK (catalogue keys with no literal call found): computed
 * intentionally as informational output only, never a hard assertion —
 * every key under a computed-key family (class 1 above) will show up here
 * as "unused" when it isn't, and a noisy false-positive report is how a
 * useful check gets disabled. If tightening this into a real assertion is
 * ever wanted, it needs the computed-key families enumerated and excluded
 * first.
 */

const SCAN_DIRS = ["app", "components", "server", "lib"];
// process.cwd(), not __dirname: __dirname is a CJS global and this project's
// tests run under Vite/ESM (check-duplicate-keys.test.ts uses the same
// process.cwd()-relative pattern for the exact same reason).
const ROOT = process.cwd();

function keyPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (
      (extname(entry) === ".ts" || extname(entry) === ".tsx") &&
      !entry.endsWith(".d.ts") &&
      !entry.includes(".test.")
    ) {
      out.push(full);
    }
  }
  return out;
}

// `const NAME = (await )?(useTranslations|getTranslations)("namespace")` —
// namespace group is undefined for the argument-less form.
const BIND_RE =
  /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:(["'])((?:[^\\]|\\.)*?)\2)?\s*\)/g;

interface Reference {
  file: string;
  fullKey: string;
}
interface Unresolvable {
  file: string;
  varName: string;
  raw: string;
}

function extractReferences(files: string[]): { resolved: Reference[]; unresolvable: Unresolvable[] } {
  const resolved: Reference[] = [];
  const unresolvable: Unresolvable[] = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const bindings = new Map<string, string>();
    for (const m of text.matchAll(BIND_RE)) {
      const varName = m[1];
      const ns = m[3] ?? "";
      bindings.set(varName, ns);
    }
    if (bindings.size === 0) continue;

    for (const [varName, ns] of bindings) {
      const litRe = new RegExp(`\\b${varName}\\(\\s*(["'])((?:[^\\\\]|\\\\.)*?)\\1`, "g");
      for (const m of text.matchAll(litRe)) {
        const key = m[2];
        resolved.push({ file, fullKey: ns ? `${ns}.${key}` : key });
      }

      const tplRe = new RegExp(`\\b${varName}\\(\\s*\`([^\`]*)\``, "g");
      for (const m of text.matchAll(tplRe)) {
        const tmpl = m[1];
        if (tmpl.includes("${")) {
          unresolvable.push({ file, varName, raw: tmpl });
        } else {
          resolved.push({ file, fullKey: ns ? `${ns}.${tmpl}` : tmpl });
        }
      }
    }
  }
  return { resolved, unresolvable };
}

describe("every literally-referenced t()/getTranslations() key resolves in both catalogues", () => {
  const files = SCAN_DIRS.flatMap((d) => listSourceFiles(join(ROOT, d)));
  const { resolved, unresolvable } = extractReferences(files);

  if (unresolvable.length > 0) {
    console.log(
      `i18n-key-resolution: ${unresolvable.length} computed-key call site(s) not checked (template literal with interpolation):`,
      unresolvable.map((u) => `${u.file}: ${u.varName}(\`${u.raw}\`)`),
    );
  }

  // The MD's condition on this whole class of check: an extractor that
  // matches nothing reports "all keys resolve" and is indistinguishable
  // from a real pass. This does not replace the planted-control proof
  // (remove a real key, confirm this test goes red) — it only catches the
  // extractor silently finding zero files or zero calls.
  it("scanned at least one source file and found at least one resolvable key reference", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(resolved.length).toBeGreaterThan(0);
  });

  it("has no key referenced in code that's missing from messages/en.json", () => {
    const enKeys = new Set(keyPaths(en));
    const missing = [...new Set(resolved.filter((r) => !enKeys.has(r.fullKey)).map((r) => r.fullKey))].sort();
    expect(missing).toEqual([]);
  });

  it("has no key referenced in code that's missing from messages/zh-CN.json", () => {
    const zhKeys = new Set(keyPaths(zhCN));
    const missing = [...new Set(resolved.filter((r) => !zhKeys.has(r.fullKey)).map((r) => r.fullKey))].sort();
    expect(missing).toEqual([]);
  });

  // Informational only — see the file header for why this is never a hard
  // assertion. Logged so a human can look, not enforced.
  it("logs catalogue keys with no literal call found (informational, not a failure)", () => {
    const enKeys = new Set(keyPaths(en));
    const referenced = new Set(resolved.map((r) => r.fullKey));
    const uncalled = [...enKeys].filter((k) => !referenced.has(k));
    if (uncalled.length > 0) {
      console.log(
        `i18n-key-resolution: ${uncalled.length} en.json key(s) have no literal call found — this OVERSTATES real dead keys (includes every computed-key family from the header comment); not a failure.`,
      );
    }
    expect(true).toBe(true);
  });
});
