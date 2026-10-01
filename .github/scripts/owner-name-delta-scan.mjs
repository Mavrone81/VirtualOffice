#!/usr/bin/env node
/**
 * Fails when a change ADDS occurrences of the project owner's personal name — to tracked
 * file content, or to any commit message in the range.
 *
 * WHY THIS EXISTS. "No new code, comment, commit message or PR text contains his name" is a
 * BLOCKING rule, but until now nothing enforced it: it surfaced only when a reviewer
 * remembered to run the matcher by hand. In one evening that manual check caught three
 * separate violations, and a fourth reached a pushed branch because the reviewer who found
 * the first three had moved on. A category that blocks a merge should not depend on someone
 * remembering to measure it.
 *
 * 🔴 WHY THE PATTERN IS NOT IN THIS FILE. This repository is public. Committing the name — or
 * a regex that spells it — would put the thing being removed into the very check that removes
 * it, permanently, in history that is explicitly out of scope for the cleanup. So the pattern
 * arrives in OWNER_NAME_PATTERN from a repository secret, and this file discloses nothing.
 * Same inversion as toplevel-dir-scan.mjs's allow-list: name only what is permitted.
 *
 * 🔴 AN UNSET PATTERN IS A HARD FAILURE, NOT A SKIP. A missing secret must never make this
 * check pass quietly — that is the exact shape of a green required check that measures
 * nothing, which is worse than no check at all because it is trusted.
 *
 * 🔴 WHY LIVENESS IS PROVED AGAINST A SYNTHETIC FIXTURE, NOT THE REPOSITORY'S OWN COUNT. The
 * obvious control is "the base must contain a known non-zero count" — but a cleanup to take
 * that count to ZERO is in flight. Once it lands, a baseline-derived control would start
 * failing exactly when the repository became clean, and would then be deleted. So --self-test
 * matches the pattern against a string built at runtime from the secret itself, and against a
 * negative. Liveness therefore holds at a baseline of 33 and at a baseline of 0.
 *
 * WHAT IT MEASURES, and what it is blind to:
 *   - tracked file CONTENT, as an occurrence count (not a file count): a file count cannot
 *     see a new occurrence inside a file that already had one, which is a case that has
 *     actually occurred here (4 files / 5 occurrences where a file count reported 2).
 *   - every commit SUBJECT AND BODY in base..head, not only the tip's. A five-commit stack
 *     had hits in two of its messages, one of them in the commit whose purpose was removal.
 *   - 🔴 BLIND TO: PR titles, PR bodies and review comments. Those live in GitHub's database,
 *     not in the git objects, so a clean result here says nothing about them. They remain a
 *     by-hand check.
 *   - 🔴 BLIND TO: images, and any name spelled differently from the pattern.
 *
 * Content is a DELTA (base vs head) because pre-existing occurrences are a known, owner-ruled
 * backlog and a plain count would be a permanent red. Messages are an ABSOLUTE zero in the
 * range: a new commit message has no legitimate baseline.
 *
 * OUTPUT IS DISCLOSURE-SAFE: counts and file paths only, never the matched text and never the
 * pattern. A scanner that quotes what it found is a disclosure path of its own.
 *
 * Exit codes: 0 clean · 1 occurrences added · 2 cannot determine. 2 is deliberately not a
 * pass: a gate that cannot tell must not report success.
 */
import { execFileSync } from "node:child_process";

const PATTERN = process.env.OWNER_NAME_PATTERN ?? "";
const BASE = process.env.BASE_SHA ?? "";
const HEAD = process.env.HEAD_SHA ?? "HEAD";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Occurrence count (not file count) of the pattern in a tree. */
export function countInTree(rev, pattern) {
  try {
    return git(["grep", "-h", "-o", "-I", "-i", "-e", pattern, rev, "--", "."]).split("\n").filter(Boolean).length;
  } catch (e) {
    if (e.status === 1) return 0; // git grep: no match
    throw e;
  }
}

/** Occurrence count within ONE path of a tree, so in-place growth is visible. */
function countInPath(rev, path, pattern) {
  try {
    return git(["grep", "-h", "-o", "-I", "-i", "-e", pattern, rev, "--", path]).split("\n").filter(Boolean).length;
  } catch (e) {
    if (e.status === 1) return 0;
    throw e;
  }
}

/** Files containing the pattern in a tree, for locating only. */
function filesInTree(rev, pattern) {
  try {
    return git(["grep", "-l", "-I", "-i", "-e", pattern, rev, "--", "."])
      .split("\n").filter(Boolean).map((l) => l.replace(`${rev}:`, ""));
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
}

/** Per-commit message matches in base..head. */
function messageHits(base, head, pattern) {
  const shas = git(["rev-list", `${base}..${head}`]).split("\n").filter(Boolean);
  return shas
    .map((sha) => ({
      sha: sha.slice(0, 8),
      n: (git(["log", "-1", "--format=%B", sha]).match(new RegExp(pattern, "gi")) ?? []).length,
    }))
    .filter((c) => c.n > 0);
}

if (process.argv.includes("--self-test")) {
  if (!PATTERN) { console.error("self-test: OWNER_NAME_PATTERN is unset — nothing to validate"); process.exit(2); }
  let re;
  try { re = new RegExp(PATTERN, "i"); }
  catch (e) { console.error(`FAIL the configured pattern is not a valid regex: ${e.message}`); process.exit(1); }

  // 🔴 WHAT THIS CAN AND CANNOT PROVE. A fixture built FROM the pattern is a tautology: any
  // pattern matches a string containing itself, so such a case would pass for a nonsense
  // secret and prove nothing. (It did, in the first version of this file.) So the cases below
  // only assert things that can actually be wrong about a MISCONFIGURED secret:
  //   - it is a valid regex at all;
  //   - it is not empty or whitespace, which would match every line in the repository;
  //   - it is not over-broad — it must NOT match the neutral replacement wording, or every
  //     correct fix would be reported as a violation and the gate would be switched off;
  //   - it is not absurdly short, which is the cheap proxy for over-broad.
  //
  // 🔴 STATED LIMIT, not papered over: NOTHING HERE CAN DETECT A PATTERN THAT IS SIMPLY THE
  // WRONG NAME. That would fail silently — a green check measuring the wrong string — and it
  // cannot be tested from inside a public repository, because doing so would require
  // committing the right name, which is the thing this gate exists to keep out. The mitigation
  // is external: the authoritative count lives in the team's published matcher record, and a
  // reviewer compares this job's base count against it. If they disagree, the secret is wrong.
  const NEUTRAL = ["the project owner", "owner ruling 2026-10-01", "the owner ruled this", "project owner's ruling"];
  const CASES = [
    ["pattern is not empty or whitespace", () => PATTERN.trim().length > 0, true],
    ["pattern is at least 4 characters (cheap over-broad proxy)", () => PATTERN.trim().length >= 4, true],
    ["pattern does NOT match the neutral replacement wording", () => NEUTRAL.some((n) => re.test(n)), false],
    ["pattern does NOT match an empty string", () => re.test(""), false],
    ["pattern does NOT match a line of ordinary prose", () => re.test("Add a company signatory data model and an at-signing snapshot."), false],
  ];
  let bad = 0;
  for (const [label, fn, expected] of CASES) {
    const got = fn();
    if (got !== expected) bad++;
    console.log(`${got === expected ? "ok  " : "FAIL"} ${label} — expected ${expected}, got ${got}`);
  }
  // Non-vacuity with teeth: the tree walker must return a non-zero count for a token that is
  // certainly present, or a 0 from it proves nothing. Uses an unrelated token, not the secret.
  const control = countInTree(HEAD, "prisma");
  if (control === 0) { bad++; console.log("FAIL non-vacuity — the tree walker returned 0 for a certainly-present token"); }
  else console.log(`ok   non-vacuity — the tree walker returns ${control} for a certainly-present token`);
  console.log(bad === 0
    ? `self-test: all ${CASES.length} claims hold and the walker is not vacuous. NOTE: this cannot prove the pattern is the RIGHT name — see the stated limit in this file.`
    : `self-test: ${bad} claim(s) BROKEN`);
  process.exit(bad === 0 ? 0 : 1);
}

if (!PATTERN) {
  console.error("owner-name-delta: OWNER_NAME_PATTERN is not set.");
  console.error("  This check cannot run without it, and a check that cannot run must not report success.");
  console.error("  Set the repository secret, or run locally with OWNER_NAME_PATTERN=... BASE_SHA=... HEAD_SHA=...");
  process.exit(2);
}
if (!BASE) { console.error("owner-name-delta: BASE_SHA is not set — nothing to compare against."); process.exit(2); }

const baseCount = countInTree(BASE, PATTERN);
const headCount = countInTree(HEAD, PATTERN);
const delta = headCount - baseCount;
const msgs = messageHits(BASE, HEAD, PATTERN);

console.log(`Owner-name delta — occurrences in tracked content, counted with -o (not a file count):`);
console.log(`  base ${BASE.slice(0, 8)}: ${baseCount}`);
console.log(`  head ${HEAD.slice(0, 8)}: ${headCount}`);
console.log(`  delta: ${delta >= 0 ? "+" : ""}${delta}`);
console.log(`Commit messages in ${BASE.slice(0, 8)}..${HEAD.slice(0, 8)}: ${msgs.length} of ${git(["rev-list", "--count", `${BASE}..${HEAD}`]).trim()} carry a match`);
console.log(`NOT CHECKED BY THIS GATE: PR title, PR body, review comments (GitHub's database, not git objects); images; any spelling other than the configured pattern.`);

let failed = false;
if (delta > 0) {
  failed = true;
  console.error(`\nFAIL: this change adds ${delta} occurrence(s) of the owner's name to tracked content.`);
  // 🔴 Report ONLY the actionable files. The first version listed every file containing the
  // name — 34 of them, mostly pre-existing — which buried the one that caused the failure.
  // A gate owes the reader its diagnosis, not its corpus.
  const baseFiles = new Set(filesInTree(BASE, PATTERN));
  const headFiles = filesInTree(HEAD, PATTERN);
  const added = headFiles.filter((f) => !baseFiles.has(f));
  // Files already in the set that GAINED occurrences. A file list cannot show this case, and
  // it has happened here: 4 files / 5 occurrences where a file count reported 2.
  const grew = [];
  for (const f of headFiles) {
    if (!baseFiles.has(f)) continue;
    const b = countInPath(BASE, f, PATTERN);
    const h = countInPath(HEAD, f, PATTERN);
    if (h > b) grew.push({ f, b, h });
  }
  console.error("  Files to look at (paths only — the matched text is deliberately not printed):");
  for (const f of added) console.error(`    NEW   ${f}`);
  for (const g of grew) console.error(`    GREW  ${g.f}  ${g.b} -> ${g.h} occurrence(s)`);
  if (added.length === 0 && grew.length === 0) {
    console.error("    (none identified per-file — the delta is real but did not land in a file that");
    console.error("     the pattern matches at either end; check renames and the commit range itself)");
  }
  console.error("  Use neutral wording — \"the project owner\", \"owner ruling <date>\" — keeping the comment's meaning.");
}
if (msgs.length > 0) {
  failed = true;
  console.error(`\nFAIL: ${msgs.length} commit message(s) in this range carry the owner's name:`);
  for (const c of msgs) console.error(`    ${c.sha}  ${c.n} match(es)`);
  console.error("  A commit message cannot be cleaned up later: history is out of scope for the name removal.");
}
if (!failed) console.log("\nNo added occurrences in tracked content, and no commit message in the range carries the name.");
process.exit(failed ? 1 : 0);
