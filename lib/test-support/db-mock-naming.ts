import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";

/** A test file that imports the real `@/lib/db` (no `vi.mock` of it in the same file) is
 *  DB-dependent whether or not its name says so. Two shapes make that safe today:
 *
 *    - named `*.integration.test.ts` — the integration/integration-unsuffixed vitest
 *      projects give it db-preflight.ts's reachability check (see vitest.config.ts).
 *    - listed in DB_UNSUFFIXED_TEST_FILES — same preflight, via the
 *      "integration-unsuffixed" project, keyed by exact path instead of suffix.
 *
 *  Anything else is the bug db-preflight.ts was built to close, reopened: it runs under
 *  "unit" with no reachability check, fails inside its own beforeAll/beforeEach when
 *  Postgres is down, and (for a beforeAll file) reports every test SKIPPED, not FAILED.
 *  A list of 12 files is a snapshot of today; this walk is the assertion that stays true
 *  after a 13th file is added by someone who never read this comment.
 */

const REAL_IMPORT = /from\s+["']@\/lib\/db["']/;
const MOCKS_IT = /vi\.mock\(\s*["']@\/lib\/db["']/;
const TEST_FILE = /\.test\.ts$/;
const INTEGRATION_FILE = /\.integration\.test\.ts$/;

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && TEST_FILE.test(entry.name)) out.push(full);
  }
}

export interface Violation {
  file: string;
  reason: string;
}

/** Scans every `server/**\/*.test.ts` and `lib/**\/*.test.ts` file under `repoRoot`.
 *  Returns one entry per file that imports the real `@/lib/db`, is not named
 *  `*.integration.test.ts`, and is not in `allowlist` (repo-relative, forward-slash paths).
 *  Also returns `filesScanned` via the second element so callers can report what ran. */
export function findDbNamingViolations(
  repoRoot: string,
  allowlist: readonly string[],
): { violations: Violation[]; filesScanned: number } {
  const files: string[] = [];
  for (const dir of ["server", "lib"]) walk(join(repoRoot, dir), files);

  const allowed = new Set(allowlist);
  const violations: Violation[] = [];

  for (const absPath of files) {
    const relPath = relative(repoRoot, absPath).split(sep).join("/");
    if (INTEGRATION_FILE.test(relPath)) continue; // already covered by project routing
    if (allowed.has(relPath)) continue; // explicitly routed to integration-unsuffixed

    const content = readFileSync(absPath, "utf8");
    if (REAL_IMPORT.test(content) && !MOCKS_IT.test(content)) {
      violations.push({
        file: relPath,
        reason:
          "imports the real @/lib/db (no matching vi.mock) but is named like a plain " +
          "unit test and is not in DB_UNSUFFIXED_TEST_FILES — it would run under the " +
          "'unit' vitest project with no database-reachability check.",
      });
    }
  }

  return { violations, filesScanned: files.length };
}
