#!/usr/bin/env node
// Reports which variables a FRESH COPY of .env.example still needs, using the REAL schema.
//
//   node --import tsx scripts/check-env-example.mjs     (or: npx tsx scripts/…)
//
//   exit 0  a copy of .env.example alone satisfies the contract
//   exit 1  it does not — every offending variable is listed with its reason
//   exit 2  the check itself could not run (file missing, or a parse that read nothing)
//
// 🔴 A non-zero exit is NOT necessarily a defect. .env.example deliberately leaves the session
// secret commented out so a copied .env fails closed instead of booting with a publicly-known
// value, and its encryption-key placeholder is deliberately a "change-me". The point is that the
// failure is NAMED and immediate, rather than discovered later as a confusing test summary.
//
// All logic lives in lib/env-example-check.ts so this CLI and the drift test share one
// implementation. See that file for why it uses the schema rather than parsing key names.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = join(root, ".env.example");

if (!existsSync(examplePath)) {
  console.error("check-env-example: .env.example not found at the repo root");
  process.exit(2);
}

const { checkEnvExample } = await import("../lib/env-example-check.ts");
const text = readFileSync(examplePath, "utf8");
const report = checkEnvExample(text);

// 🔴 Report the input count: a dead parse and a complete file both yield "0 problems".
console.log(
  `check-env-example: read ${report.bytesRead} bytes; ${report.parsedKeys.length} key(s) set, ` +
    `${report.commentedKeys.length} key(s) present but commented out`,
);
if (report.parsedKeys.length === 0) {
  console.error("check-env-example: parsed 0 keys — refusing to report a clean result from an empty parse");
  process.exit(2);
}

if (report.unsatisfied.length === 0) {
  console.log("check-env-example: OK — a copy of .env.example alone satisfies the contract");
  process.exit(0);
}

console.error("");
console.error(`check-env-example: a fresh copy of .env.example needs ${report.unsatisfied.length} value(s) set:`);
for (const l of report.unsatisfied) console.error(`  - ${l}`);
console.error("");
console.error("Generate the two secrets with:");
console.error("  AUTH_SECRET          openssl rand -base64 32");
console.error("  PII_ENCRYPTION_KEY   openssl rand -hex 32     # 64 hex characters, min 64");
console.error("");
process.exit(1);
