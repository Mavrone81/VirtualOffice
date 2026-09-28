#!/usr/bin/env node
/**
 * Fails on any TRACKED file with a document/office extension outside an explicit,
 * directory-scoped allow-list.
 *
 * WHY EXTENSION AND NOT NAMES: a list of known filenames only looks backwards, and
 * writing the names of documents we do not want in the repo INTO the repo tells a reader
 * exactly what to go looking for in history. The extension carries the meaning; the
 * allow-list names only the directories that are legitimately allowed to hold documents.
 * Nothing in this file or the allow-list names anything we are keeping out.
 *
 * WHY TRACKED FILES: an untracked file is not in the repository and cannot reach a PR,
 * a bundle, or `git archive`. `git ls-files` is the population that actually ships.
 * (An `rm` or a .gitignore entry does nothing about a file that is already tracked —
 * which is exactly the gap this gate exists to close.)
 *
 * ON PRINTING VIOLATION PATHS: a violation's path is printed. That is not a disclosure —
 * if this gate fires, the file is already committed and already visible in the PR's own
 * file list. The path is what makes the failure actionable. The gate never prints file
 * CONTENTS, and never names a non-violating path outside the allow-list report.
 *
 * ALLOW-LIST LOCATION: deliberately at the repository root, NOT under .github/. A
 * wrong-side conflict resolution in a workflow file can delete a gate with every test
 * still green, and every amendment that touches .github/ is another chance at that. A
 * legitimate new document directory should be one data-file change, reviewable on its own.
 *
 * Exit codes: 0 clean · 1 violations found · 2 cannot determine (config/git unavailable).
 * 2 is deliberately NOT a pass: a gate that cannot tell must not report success.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ALLOWLIST = "document-file-allowlist.tsv";
const EXTENSIONS = ["xlsx", "xls", "docx", "doc", "pdf"];
const EXT_RE = new RegExp(`\\.(${EXTENSIONS.join("|")})$`, "i");

/** Directory-scoped. An entry always compares with a trailing "/", so an entry of
 *  `docs/t/` allows `docs/t/x.pdf` and does NOT allow `docs/theft/x.pdf` — a bare
 *  startsWith on the raw entry would wrongly allow the second. */
export function isAllowed(path, dirs) {
  return dirs.some((d) => path.startsWith(d.endsWith("/") ? d : d + "/"));
}
export function isDocument(path) {
  return EXT_RE.test(path);
}

function loadAllowlist() {
  let text;
  try {
    text = readFileSync(ALLOWLIST, "utf8");
  } catch {
    console.error(`cannot read ${ALLOWLIST} — refusing to report a pass without it`);
    process.exit(2);
  }
  const entries = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim() || line.startsWith("#")) return;
    const parts = line.split("\t").filter((p) => p !== "");
    if (parts.length < 2) {
      console.error(`${ALLOWLIST}:${i + 1}: need 2 tab-separated fields (directory, reason) — every entry must carry a reason`);
      process.exit(2);
    }
    entries.push({ dir: parts[0].trim(), reason: parts.slice(1).join(" ").trim(), line: i + 1 });
  });
  return entries;
}

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { maxBuffer: 64 * 1024 * 1024 })
      .toString("utf8").split("\0").filter(Boolean);
  } catch {
    console.error("cannot list tracked files (git unavailable or not a repository) — refusing to assume OK");
    process.exit(2);
  }
}

function scan(files, allowDirs) {
  const documents = files.filter(isDocument);
  const violations = documents.filter((f) => !isAllowed(f, allowDirs));
  return { documents, violations };
}

// ---------------------------------------------------------------------------
// --self-test: proves the matcher's shape claims through the real code path, and
// proves NON-VACUITY with teeth — neutralise the allow-list and require that the
// documents this repo legitimately holds are still found. A scanner that walked past
// everything would pass a file count and fail this.
// ---------------------------------------------------------------------------
const CASES = [
  ["a .pdf is a document", () => isDocument("x/y.pdf"), true],
  ["extension match is case-insensitive", () => isDocument("x/y.PDF"), true],
  [".xlsx/.xls/.docx/.doc all match", () => ["a.xlsx", "a.xls", "a.docx", "a.doc"].every(isDocument), true],
  ["a longer extension is NOT a match", () => isDocument("x/y.pdfx"), false],
  ["the bare word is NOT a match", () => isDocument("x/ydoc"), false],
  ["an allow-listed directory allows a file inside it", () => isAllowed("docs/t/x.pdf", ["docs/t/"]), true],
  ["🔴 a SIBLING with the same prefix is NOT allowed", () => isAllowed("docs/theft/x.pdf", ["docs/t/"]), false],
  ["an entry written without a trailing slash still scopes to the directory",
    () => isAllowed("docs/theft/x.pdf", ["docs/t"]), false],
  ["a path outside every entry is not allowed", () => isAllowed("elsewhere/x.pdf", ["docs/t/"]), false],
];

if (process.argv.includes("--self-test")) {
  let bad = 0;
  for (const [label, fn, expected] of CASES) {
    const got = fn();
    const ok = got === expected;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} — expected ${expected}, got ${got}`);
  }
  // Non-vacuity: with the allow-list NEUTRALISED, every document must surface.
  const { documents, violations } = scan(trackedFiles(), []);
  const vacuous = documents.length === 0 || violations.length !== documents.length;
  if (vacuous) {
    bad++;
    console.log(`FAIL non-vacuity — allow-list neutralised: ${documents.length} document(s) matched, ${violations.length} reported`);
  } else {
    console.log(`ok   non-vacuity — allow-list neutralised, all ${documents.length} tracked document(s) surface as violations`);
  }
  console.log(bad === 0
    ? `self-test: all ${CASES.length} shape claims hold, matcher is not vacuous`
    : `self-test: ${bad} claim(s) BROKEN`);
  process.exit(bad === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Normal run
// ---------------------------------------------------------------------------
const entries = loadAllowlist();
const files = trackedFiles();
const { documents, violations } = scan(files, entries.map((e) => e.dir));

// A silent exemption is a failure: every honoured entry is reported EVERY run, with its
// reason and how many files it covered, so a rising count is visible without anyone
// going looking for it.
console.log(`Allow-list (${ALLOWLIST}) — ${entries.length} entr${entries.length === 1 ? "y" : "ies"} honoured this run:`);
for (const e of entries) {
  const covered = documents.filter((f) => isAllowed(f, [e.dir])).length;
  console.log(`  ${e.dir}  — covers ${covered} document(s) — ${e.reason}`);
  if (covered === 0) console.log(`    NOTE: this entry covered nothing this run. If it is no longer needed, delete it — an exemption nobody can justify is a debt with no due date.`);
}

console.log(`Scanned ${files.length} tracked file(s): ${documents.length} with a document extension (${EXTENSIONS.join("/")}), ${documents.length - violations.length} allow-listed, ${violations.length} unexplained.`);

// Floor. If the matcher finds NOTHING at all, that is not a clean repo — this project
// tracks agreement templates — it is a broken matcher reporting silence. Do not pass.
if (documents.length === 0) {
  console.error(`0 files matched ${EXTENSIONS.join("/")} across ${files.length} tracked files. This repository tracks document templates, so a zero here means the matcher is broken, not that the tree is clean. Refusing to report a pass.`);
  process.exit(2);
}

if (violations.length > 0) {
  for (const f of violations) console.error(`${f}: committed document outside every allow-listed directory — remove it from the repository, or add its directory to ${ALLOWLIST} with a reason`);
  console.error(`\n${violations.length} committed document(s) outside the allow-list.`);
  process.exit(1);
}
console.log("No committed documents outside the allow-list.");
