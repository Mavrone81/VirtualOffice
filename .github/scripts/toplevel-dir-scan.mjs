#!/usr/bin/env node
/**
 * Fails on any TRACKED top-level DIRECTORY that is not in an explicit allow-list of the
 * repository's legitimate roots.
 *
 * WHY THIS SHAPE. The risk is a directory of material being re-added to a public repo by a
 * carve or a stale-base rebuild. The obvious check — a denylist of forbidden paths — is
 * unusable here: naming a forbidden path in a public repo tells a reader exactly what used
 * to be there and where to look for it in history. This inverts it. The allow-list names
 * ONLY permitted roots, so the file discloses nothing, and anything unexpected is caught
 * whatever it is called and whatever it contains.
 *
 * 🔴 WHY IT COMPLEMENTS THE DOCUMENT-EXTENSION GATE RATHER THAN DUPLICATING IT. That gate
 * is blind to a directory containing no document-extension files — a markdown-only
 * re-add passes it clean. This one is blind to files added INSIDE an already-permitted
 * root. Two axes; neither is complete alone. The planted control below is deliberately a
 * new top-level directory holding only a .md file, which is exactly the case the other gate
 * cannot see.
 *
 * 🔴 STATED LIMIT: files carved into an EXISTING top-level directory are invisible to this
 * check. Measured 2026-09-28: of the refs that track the material this was built for, all
 * of them track it at top level and none nests it — so the route this catches is the real
 * one today, but a deliberate placement under an existing root would slip past, and that
 * case is covered only by the kit-manifest assertion.
 *
 * DIRECTORIES ONLY, NOT TOP-LEVEL FILES. Measured over this repo's whole history: new
 * top-level directories appeared in 10 commits, 8 of them legitimate and only 2 in the last
 * two months — a quiet signal. Top-level FILES churn far more (one config file was added
 * three separate times in a single day). Including files would make this fire during
 * ordinary work, and a gate that is cheap to dismiss stops being a gate.
 *
 * Exit codes: 0 clean · 1 unexpected root found · 2 cannot determine. 2 is deliberately not
 * a pass: a gate that cannot tell must not report success.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ALLOWLIST = "toplevel-allowlist.tsv";

export function topLevelDirs(paths) {
  const dirs = new Set();
  for (const p of paths) {
    const i = p.indexOf("/");
    if (i > 0) dirs.add(p.slice(0, i));
  }
  return [...dirs].sort();
}

function loadAllowlist() {
  let text;
  try { text = readFileSync(ALLOWLIST, "utf8"); }
  catch { console.error(`cannot read ${ALLOWLIST} — refusing to report a pass without it`); process.exit(2); }
  const entries = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim() || line.startsWith("#")) return;
    const parts = line.split("\t").filter((p) => p !== "");
    if (parts.length < 2) {
      console.error(`${ALLOWLIST}:${i + 1}: need 2 tab-separated fields (directory, reason) — every entry must carry a reason`);
      process.exit(2);
    }
    // Trailing slashes tolerated in the file, stripped for an exact name comparison. This
    // check matches a top-level NAME exactly; it is not a prefix test, so a root sharing a
    // name prefix with a permitted one is not permitted.
    entries.push({ dir: parts[0].trim().replace(/\/+$/, ""), reason: parts.slice(1).join(" ").trim() });
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

const CASES = [
  ["a nested path yields its top-level directory", () => topLevelDirs(["app/x/y.ts"]).join(), "app"],
  ["a root-level FILE is not a directory", () => topLevelDirs(["package.json"]).join(), ""],
  ["several files in one directory collapse to one entry", () => topLevelDirs(["lib/a.ts", "lib/b.ts"]).join(), "lib"],
  ["a directory name containing spaces survives intact", () => topLevelDirs(["16 Jul Meeting/a.md"]).join(), "16 Jul Meeting"],
  ["🔴 an exact-name match, NOT a prefix match", () => {
      const allowed = new Set(["doc"]);
      return topLevelDirs(["docs/a.pdf"]).filter((d) => !allowed.has(d)).join();
    }, "docs"],
  ["a permitted root is not reported", () => {
      const allowed = new Set(["app"]);
      return topLevelDirs(["app/x.ts"]).filter((d) => !allowed.has(d)).join();
    }, ""],
];

if (process.argv.includes("--self-test")) {
  let bad = 0;
  for (const [label, fn, expected] of CASES) {
    const got = fn();
    const ok = got === expected;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  }
  // Non-vacuity with teeth: neutralise the allow-list and require that the repository's
  // real roots surface. A walker that returned nothing would pass a count and fail this.
  const dirs = topLevelDirs(trackedFiles());
  if (dirs.length === 0) { bad++; console.log("FAIL non-vacuity — allow-list neutralised and 0 top-level directories found"); }
  else console.log(`ok   non-vacuity — allow-list neutralised, ${dirs.length} top-level director(y/ies) surface`);
  console.log(bad === 0 ? `self-test: all ${CASES.length} shape claims hold, walker is not vacuous` : `self-test: ${bad} claim(s) BROKEN`);
  process.exit(bad === 0 ? 0 : 1);
}

const entries = loadAllowlist();
const allowed = new Set(entries.map((e) => e.dir));
const files = trackedFiles();
const dirs = topLevelDirs(files);
const unexpected = dirs.filter((d) => !allowed.has(d));

// A silent exemption is a failure: every honoured entry is reported every run, with how
// many tracked files it covers, so a rising count is visible without anyone going looking.
console.log(`Allow-list (${ALLOWLIST}) — ${entries.length} permitted root(s) honoured this run:`);
for (const e of entries) {
  const covered = files.filter((f) => f.startsWith(e.dir + "/")).length;
  console.log(`  ${e.dir}/  — ${covered} tracked file(s) — ${e.reason}`);
  if (covered === 0) console.log(`    NOTE: this entry covered nothing this run. If the directory is gone, delete the entry — an exemption nobody can justify is a debt with no due date.`);
}
console.log(`Scanned ${files.length} tracked file(s): ${dirs.length} top-level director(y/ies), ${dirs.length - unexpected.length} permitted, ${unexpected.length} unexpected.`);

if (dirs.length === 0) {
  console.error(`0 top-level directories across ${files.length} tracked files. This repository has several, so a zero means the walker is broken, not that the tree is clean. Refusing to report a pass.`);
  process.exit(2);
}
if (unexpected.length > 0) {
  for (const d of unexpected) {
    const n = files.filter((f) => f.startsWith(d + "/")).length;
    console.error(`${d}/: unexpected top-level directory (${n} tracked file(s)) — if it does not belong in this repository, remove it from the commit; if it does, add it to ${ALLOWLIST} with a reason`);
  }
  console.error(`\n${unexpected.length} unexpected top-level director(y/ies).`);
  process.exit(1);
}
console.log("No unexpected top-level directories.");
