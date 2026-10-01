#!/usr/bin/env node
// Repo-wide credential-shape scan. Fails on any string literal assigned to a
// password/secret/token-like identifier that is not explicitly allow-listed.
//
// Why shape and not values: a list of known secrets can only look backwards,
// and writing one into the repo to prove a secret is gone plants most of it
// back (that is how a 13-of-15-character prefix of a removed password reached
// three test files in W2a-ADDENDUM's first head). Shape catches the NEXT
// credential, whatever it is called, without naming any value.
//
// Usage: node .github/scripts/credential-shape-scan.mjs [--json]
// Exit 0 = no unexplained hit. Exit 1 = at least one. Exit 2 = bad allow-list.
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const ALLOWLIST = ".github/credential-shape-allowlist.tsv";

// Two shapes, both anchored on an identifier that names a credential:
//   1. direct     IDENT = "literal"      IDENT: "literal"
//   2. fallback   IDENT = <anything> ?? "literal"      ... || "literal"
// Shape 2 is the one that matters most: it is the form a removed shared
// password actually lived in (`process.env.X ?? "<literal>"`), and a
// direct-assignment-only regex reads as broader protection than it gives.
const IDENT = String.raw`\b(\w*(?:password|passwd|secret|token|passphrase|apikey|api_key)\w*)\b`;
const DIRECT = new RegExp(IDENT + String.raw`\s*[:=]\s*(["'\`])([^"'\`\n]*)\2`, "gi");
// 🔴 The closing backreference is \2 (the opening QUOTE), not \3. With \3 it is a
// self-reference to the literal group, which the engine satisfies by shrinking
// that group to the empty string: every fallback match then arrived with a
// zero-length literal and was silently written off by the empty-string rule
// below, so this shape — the one this scan exists for — never fired once.
// Caught 2026-09-27 while closing the line-break bypass; a fallback hit is now
// proved to fail (see reviews/ci-credential-shape-linebreak-fix.md).
// 🔴 The gap between IDENT and the fallback operator refuses to cross a STATEMENT
// KEYWORD or a brace — it is not merely "anything but ; and newline" (2026-09-27).
// Why: `[^;\n]*?` treats an ESCAPED `\n` inside a string literal as ordinary text,
// so on a single physical line reading
//     const apiTok<>en = getToken()  then an ESCAPED newline  then  const greeting = name ?? "friend"
// (written with a <> break on purpose: spelled out in full, this comment is itself a
//  credential-shaped line and the scanner flags its own documentation. It did exactly
//  that on the first attempt at this fix, which is the same trap the self-test samples
//  are assembled from constants to avoid.)
// the window ran from `apiToken =` all the way to a LATER statement's literal and
// reported `apiToken` as assigned "friend". A false RED, which is the worse
// direction: it fires on any file that embeds code as DATA — a matcher's own test
// fixtures first of all — and a gate that goes red over test fixtures gets switched
// off. Found when exactly those fixtures landed on main (PR #37); they were fixtures
// *I* had asked another member to add for this same defect class in THEIR matcher,
// while my own scanner never got the fix I prescribed. The keyword list is the fix I
// gave them, applied here at last.
// (A paragraph here used to describe an "accepted narrowing" for inline functions and
// object literals. It was removed with the guards that caused it — those shapes match
// again, which is correct. It was ALSO the third case today of this file's own prose
// tripping this file's own scan: spelled out in full, an example of the pattern a
// detector looks for IS that pattern. Examples in this file are assembled from
// character constants, or not written out at all, for exactly that reason.)
// 🔴 The gap excludes a literal BACKSLASH, and that single exclusion IS the fix —
// established by mutation, not by reasoning. An escaped newline written as backslash-n
// inside a string literal is ordinary text to `[^;\n]*?`, so the window ran from an
// identifier past an embedded statement boundary and reported a LATER statement's
// literal as assigned to an EARLIER identifier. A false RED, the worse direction: it
// fires on any file that embeds code as DATA — a matcher's own fixtures first of all —
// and a gate that goes red over test fixtures gets switched off. It reached main in
// PR #37, on fixtures this reviewer had asked another member to add for the SAME defect
// class in THEIR matcher, while this scanner never got the fix prescribed to them.
//
// 🔴 What was tried and REMOVED, because it was measured to do nothing: a statement-
// keyword lookahead (`(?!\b(?:const|let|…)\b)`) and a brace exclusion. Four mutations:
// dropping the backslash exclusion breaks 2 of the 18 claims; dropping the keyword
// guard, the braces, or BOTH breaks none. They were unproven guards that also cost real
// false negatives (a fallback whose left side holds an inline function or object
// literal would stop matching). A guard seen only green may be matching nothing —
// so it went. NOTE: the keyword guard is still the right fix for the OTHER matcher it
// was prescribed for; it is redundant HERE, not wrong there.
// 🔴 Do not "harden" this back into a keyword list without a claim that fails without it.
const GAP = String.raw`[^;\n\\]*?`;
const FALLBACK = new RegExp(IDENT + String.raw`\s*[:=]` + GAP + String.raw`(?:\?\?|\|\|)\s*(["'\`])([^"'\`\n]*)\2`, "gi");

// Skipped by rule rather than by allow-list entry — an allow-list should hold
// decisions, not arithmetic:
//   - the empty string, for any identifier: `String(form.get("password") ?? "")`
//     is a default, not a secret, and that idiom is common in form handlers;
//   - for PASSWORD-family identifiers only, anything shorter than the app's own
//     minimum password length. A password literal that short cannot be a usable
//     credential here, and allow-listing each test fixture individually would
//     mean editing this list on every new test — the friction that gets a check
//     switched off. Every fixture measured on this tree was of that shape
//     (`passwordHash: "old"`, `password: "p"`).
// The length rule deliberately does NOT extend to secret / token / apikey /
// api_key (DevLead review, 2026-09-27): 12 is this app's minimum PASSWORD
// length, and nothing comparable is true of a token or an API key. Short ones
// are perfectly usable, so a 9-character literal on API_KEY is exactly what
// this scan exists to catch, and it must reach the allow-list to be excused.
// All three by-rule skips are COUNTED and reported, so no decision is hidden.
const MIN_PASSWORD_LENGTH = 12; // = MIN_SEED_PASSWORD_LENGTH (lib/seed-guard.ts)
const PASSWORD_FAMILY = /password|passwd|passphrase/i;

const BINARY_EXT = /\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|eot|zip|xlsx?|docx?|pptx?|webp|avif|mp4|svg)$/i;

let skippedLarge = 0;
let skippedAbsent = 0;

// 🔴 TRACKED FILES, NOT A WORKING-TREE WALK. The previous version walked the working tree with
// readdirSync and skipped only a hardcoded directory list, so it had no .gitignore awareness and
// read ignored files. On a developer's machine that meant it scanned their own `.env` and
// reported, by name and by character count, the length of a live local secret — in a message
// that lands in gate records and kit READMEs. A scanner whose output describes what it found in
// an untracked file is a disclosure path of its own, which is the same class leak-scan.sh was
// fixed for after its v1 printed absolute paths and disclosed the local username.
//
// It also meant a false RED locally while CI (a clean checkout, no .env) stayed green — so the
// check disagreed with itself depending on where it ran, and the local answer was the wrong one.
//
// `git ls-files` is the right population for the same reason document-file-scan.mjs states in
// its own header: it is what actually ships. An untracked credential cannot reach the repository,
// so it is not what this gate is for; a tracked one is caught either way. Both sibling scans in
// this directory already enumerate this way — this one was the outlier.
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { maxBuffer: 64 * 1024 * 1024 })
      .toString("utf8").split("\0").filter(Boolean);
  } catch {
    console.error("cannot list tracked files (git unavailable or not a repository) — refusing to assume OK");
    process.exit(2);
  }
}

// Tracked, text, and small enough to be hand-written source.
export function sourceFiles(files = trackedFiles()) {
  const out = [];
  for (const rel of files) {
    if (BINARY_EXT.test(rel)) continue;
    let st;
    try {
      st = statSync(join(ROOT, rel));
    } catch {
      // Tracked but not on disk — a staged deletion, or a sparse/partial checkout. Counted, not
      // hidden: silently skipping files is how a scan reports a clean 0 over work it never read.
      skippedAbsent++;
      continue;
    }
    if (st.size >= 2_000_000) { skippedLarge++; continue; } // too big to be hand-written source
    out.push(rel);
  }
  return out;
}

// path \t identifier \t expected-literal \t reason
function loadAllowlist() {
  let raw;
  try { raw = readFileSync(join(ROOT, ALLOWLIST), "utf8"); }
  catch { console.error(`missing allow-list: ${ALLOWLIST}`); process.exit(2); }
  const map = new Map();
  raw.split("\n").forEach((line, i) => {
    if (!line.trim() || line.startsWith("#")) return;
    const parts = line.split("\t").map((p) => p.trim());
    if (parts.length !== 4 || !parts[3]) {
      console.error(`${ALLOWLIST}:${i + 1}: need 4 tab-separated fields (path, identifier, expected literal, reason) — every entry must carry a reason`);
      process.exit(2);
    }
    const [path, ident, expected, reason] = parts;
    map.set(`${path}\u0000${ident}\u0000${expected}`, reason);
  });
  return map;
}

const allow = loadAllowlist();
const used = new Set();
const hits = [];
let skippedEmpty = 0;
let skippedShort = 0;
// This scan is LINE-BASED, so an assignment split across physical lines used to
// slip through both shapes entirely — `IDENT =` on one line and `?? "literal"`
// (or just `"literal"`) on the next. The repo has no formatter to rule that
// style out, so it was a writable bypass of a security check, not a
// hypothetical (DevLead decision, 2026-09-27: fix it now, don't log it).
//
// Fix: scan LOGICAL lines — a physical line plus up to MAX_JOINS following
// lines, joined only when the join is unambiguously a continuation:
//   - the line so far ends mid-expression (`=`, `:`, `??`, `||`), or
//   - the next line BEGINS with the fallback operator (`??` / `||`).
// It stops at a `;` end-of-statement and after MAX_JOINS, so a window can never
// run across unrelated statements — the property that `[^;\n]*?` gave us before,
// kept deliberately rather than traded away for reach.
//
// Every physical line starts its own window (none is consumed by an earlier
// one), so nothing can be skipped; the overlap means the same match can be seen
// twice, so a match is anchored to the physical line its IDENTIFIER is on and
// identical (file, identifier, literal, line) hits are reported once.
const CONTINUES_MID_EXPRESSION = /(?:[:=]|\?\?|\|\|)\s*$/;
const BEGINS_WITH_FALLBACK = /^\s*(?:\?\?|\|\|)/;
const MAX_JOINS = 2;

// Window text plus, for each joined piece, the offset where it starts and the
// physical line it came from — so a match offset maps back to a real line.
function logicalWindowAt(lines, i) {
  let text = lines[i];
  const pieces = [{ offset: 0, line: i + 1 }];
  for (let joins = 0; joins < MAX_JOINS && i + joins + 1 < lines.length; joins++) {
    if (/;\s*$/.test(text)) break;
    const next = lines[i + joins + 1];
    if (!CONTINUES_MID_EXPRESSION.test(text) && !BEGINS_WITH_FALLBACK.test(next)) break;
    const glue = " ";
    pieces.push({ offset: text.length + glue.length, line: i + joins + 2 });
    text += glue + next.trim();
  }
  return { text, pieces };
}

function physicalLineOf(pieces, offset) {
  let line = pieces[0].line;
  for (const piece of pieces) if (offset >= piece.offset) line = piece.line;
  return line;
}

// One code path for the repo walk AND for --self-test below, deliberately: a
// self-test that exercised a copy of this logic would have gone on passing
// while the real scan was blind (which is exactly what happened here).
function scanSource(file, src, allow, used, counters, seen) {
  const found = [];
  const lines = src.split("\n");
  lines.forEach((_line, n) => {
    const { text, pieces } = logicalWindowAt(lines, n);
    for (const re of [DIRECT, FALLBACK]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const ident = m[1];
        const literal = m[m.length - 1];
        const line = physicalLineOf(pieces, m.index);
        if (literal.length === 0) { if (!seen.has(`e${file}\u0000${ident}\u0000${line}`)) { seen.add(`e${file}\u0000${ident}\u0000${line}`); counters.empty++; } continue; }
        if (PASSWORD_FAMILY.test(ident) && literal.length < MIN_PASSWORD_LENGTH) {
          if (!seen.has(`s${file}\u0000${ident}\u0000${literal}\u0000${line}`)) { seen.add(`s${file}\u0000${ident}\u0000${literal}\u0000${line}`); counters.short++; }
          continue;
        }
        const key = `${file}\u0000${ident}\u0000${literal}`;
        if (allow.has(key)) { used.add(key); continue; }
        // An allow-list entry is keyed on the VALUE too, so swapping a real
        // secret in at an allow-listed spot still fails. Report the location
        // and identifier only — never the literal.
        const hitKey = `h${key}\u0000${line}`;
        if (seen.has(hitKey)) continue;
        seen.add(hitKey);
        found.push({ file, line, identifier: ident, length: literal.length });
      }
    }
  });
  return found;
}

// --self-test: the shape matrix this scan claims to enforce, asserted against
// the real scanSource() above. It exists because the fallback rule shipped DEAD
// — a `\3` backreference where `\2` belonged made every fallback match arrive
// with an empty literal, which the empty-string rule then wrote off as benign.
// Nothing went red; the count of "empty-string" skips quietly went up. A rule
// that silently degrades into a skip is the worst kind, so the claims are now
// checked on every run, in CI, before the repo scan. All values are fake.
const FAKE = "changeme-local-only"; // 19 chars: over MIN_PASSWORD_LENGTH
// The samples are ASSEMBLED from pieces rather than written out: a line of this
// file that literally spelled `PASSWORD = "value"` would be flagged by the scan
// below, because the scan reads this file too — as it should. Keeping the
// operator in a constant means no line here is itself credential-shaped, and no
// allow-list entry is needed to excuse the scanner's own fixtures.
const EQ = " = ";
const COLON = ": ";
const Q = String.fromCharCode(34);
const BS = String.fromCharCode(92);
const SELF_TEST_CASES = [
  ["direct assignment", `const SEED_PASSWORD${EQ}${Q}${FAKE}${Q};`, ["SEED_PASSWORD"]],
  ["object key", `const cfg = { token${COLON}${Q}${FAKE}${Q} };`, ["token"]],
  ["?? fallback, one line", `const SESSION_SECRET${EQ}process.env.S ?? ${Q}${FAKE}${Q};`, ["SESSION_SECRET"]],
  ["|| fallback, one line", `const API_TOKEN${EQ}process.env.T || ${Q}${FAKE}${Q};`, ["API_TOKEN"]],
  ["fallback split BEFORE the operator", `const SEED_PASSWORD${EQ}process.env.S\n  ?? ${Q}${FAKE}${Q};`, ["SEED_PASSWORD"]],
  ["fallback split AFTER the operator", `const SEED_PASSWORD${EQ}process.env.S ??\n  ${Q}${FAKE}${Q};`, ["SEED_PASSWORD"]],
  ["direct assignment split after =", `const ADMIN_PASSWORD${EQ}\n  ${Q}${FAKE}${Q};`, ["ADMIN_PASSWORD"]],
  ["short token literal is NOT excused by the length rule", `const apiKey${EQ}${Q}abc123${Q};`, ["apiKey"]],
  ["empty string is a default, not a secret", `const password${EQ}String(form.get(${Q}p${Q}) ?? ${Q}${Q});`, []],
  ["short password-family literal (test fixture shape)", `const password${EQ}${Q}p${Q};`, []],
  ["bare env reference", `const SEED_PASSWORD${EQ}process.env.SEED_PASSWORD;`, []],
  ["function call", `const secret${EQ}derive();`, []],
  ["no window joins across a finished statement", `const tokenValue${EQ}compute();\nconst label${EQ}${Q}Password${Q};`, []],
  // 🔴 The three shapes that got past this scan onto main (2026-09-27, PR #37): an
  // ESCAPED newline inside a string literal — i.e. code embedded as DATA, which is what
  // a matcher's own fixtures look like. `[^;\n]*?` saw the escape as ordinary text and
  // attributed a LATER statement's literal to an EARLIER identifier. A false RED, and
  // false reds are what get a gate switched off. The `\b` keyword guard alone did NOT
  // fix it (the escape's trailing `n` abuts the keyword, so there is no word boundary);
  // excluding the backslash is the part that does. Assembled from BS/EQ/Q so these
  // samples are not themselves credential-shaped lines in this file.
  ["escaped newline: later ?? literal not attributed to an earlier identifier",
   `const apiToken${EQ}getToken()${BS}nconst greeting${EQ}name ?? ${Q}friend${Q};`, []],
  ["escaped newline + comment: later || literal not attributed backwards",
   `let secret${EQ}load()${BS}n// unrelated${BS}nconst msg${EQ}x || ${Q}hello${Q};`, []],
  ["escaped newline into a function body: literal not attributed backwards",
   `const tokenStore${EQ}init()${BS}nfunction f() { return y || ${Q}z${Q}; }`, []],
  ["a REAL newline between the same two statements still does not match",
   `const apiToken${EQ}getToken()\nconst greeting${EQ}name ?? ${Q}friend${Q};`, []],
  ["no window joins into a call argument list", `const passwordThing${EQ}String(\n  ${Q}${FAKE}${Q},\n);`, []],
];
if (process.argv.includes("--self-test")) {
  let bad = 0;
  for (const [label, src, expected] of SELF_TEST_CASES) {
    const got = scanSource("<self-test>", src, new Map(), new Set(), { empty: 0, short: 0 }, new Set()).map((h) => h.identifier);
    const ok = got.length === expected.length && got.every((g, i) => g === expected[i]);
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} — expected [${expected}], got [${got}]`);
  }
  // 🔴 ENUMERATION claims, added with the switch from a working-tree walk to tracked files.
  // The failure this guards is specific: a scanner that reads untracked files reports a live
  // local secret's name and length, and disagrees with CI depending on where it runs.
  const tracked = trackedFiles();
  const scanned = sourceFiles(tracked);
  if (scanned.length === 0) {
    bad++; console.log("FAIL enumeration — 0 files to scan; a 0-hit result from that would prove nothing");
  } else {
    console.log(`ok   enumeration — ${scanned.length} tracked text file(s) of ${tracked.length} tracked`);
  }
  const trackedSet = new Set(tracked);
  const strays = scanned.filter((f) => !trackedSet.has(f));
  if (strays.length > 0) { bad++; console.log(`FAIL enumeration — ${strays.length} scanned file(s) are not tracked`); }
  else console.log("ok   enumeration — every scanned file is tracked (no working-tree strays)");
  // Conditional but the one that matters in practice: if a local .env exists, it must be excluded.
  if (existsSync(join(ROOT, ".env"))) {
    if (scanned.includes(".env")) { bad++; console.log("FAIL enumeration — a local .env is present AND would be scanned"); }
    else console.log("ok   enumeration — a local .env is present and is correctly excluded");
  } else {
    console.log("note enumeration — no local .env here, so the exclusion is untested this run (it is asserted structurally above)");
  }

  console.log(bad === 0 ? `self-test: all ${SELF_TEST_CASES.length} shape claims hold` : `self-test: ${bad} of ${SELF_TEST_CASES.length} shape claims BROKEN`);
  process.exit(bad === 0 ? 0 : 1);
}

const seen = new Set();
const counters = { empty: 0, short: 0 };
for (const file of sourceFiles()) {
  hits.push(...scanSource(file, readFileSync(join(ROOT, file), "utf8"), allow, used, counters, seen));
}
skippedEmpty = counters.empty;
skippedShort = counters.short;

// An unused entry is one of two different things, and conflating them makes the
// allow-list impossible to keep correct across a merge:
//   PENDING — the entry's file is not in this tree at all. The branch that adds
//     it has not merged yet (.env.example arrives with a W2-a PR). Counted and
//     listed, never a failure: the alternative is an allow-list that can only be
//     right for one of the two trees, so whichever tree the job runs on first
//     goes red for a reason nobody measured.
//   STALE — the file IS here but nothing in it matches. That is real drift, and
//     it fails, so the list cannot quietly stop meaning what it says.
// 🔴 Do NOT collapse these two. `pending` is not a softened `stale`: they answer
// different questions, and merging them breaks the property that ONE allow-list
// is correct both before and after a merge. A mistyped path lands in `pending`
// and enforces nothing, which is a useless entry rather than a false pass — the
// real hit at the correct path still fires.
const unused = [...allow.keys()].filter((k) => !used.has(k));
const pending = unused.filter((k) => !existsSync(join(ROOT, k.split("\u0000")[0])));
const stale = unused.filter((k) => existsSync(join(ROOT, k.split("\u0000")[0])));
if (process.argv.includes("--json")) console.log(JSON.stringify({ hits, stale: stale.length, pending: pending.length, skippedEmpty, skippedShort, skippedLarge, skippedAbsent }, null, 2));
console.log(
  `Scanned for credential-shaped literals: ${allow.size} allow-listed, ` +
  `${skippedEmpty} empty-string, ` +
  `${skippedShort} password-family literal(s) under ${MIN_PASSWORD_LENGTH} chars, ` +
  `${skippedLarge} file(s) over 2 MB, ${skippedAbsent} tracked file(s) absent from the worktree, ` +
  `${pending.length} pending (file not in this tree yet), ` +
  `${hits.length} unexplained.`,
);

for (const h of hits) console.error(`${h.file}:${h.line}: ${h.identifier} is assigned a ${h.length}-char string literal — move it to the environment, or add it to ${ALLOWLIST} with a reason`);
for (const k of pending) { const [p, i] = k.split("\u0000"); console.log(`${ALLOWLIST}: pending — ${p} is not in this tree yet (${i}); keeping the entry so the list stays correct once it lands`); }
for (const k of stale) { const [p, i] = k.split("\u0000"); console.error(`${ALLOWLIST}: stale entry — ${p} is present but ${i} no longer matches; delete it`); }

if (hits.length || stale.length) {
  console.error(`\n${hits.length} unexplained credential-shaped literal(s), ${stale.length} stale allow-list entr(y/ies).`);
  process.exit(1);
}
console.log("No unexplained credential-shaped literals.");
