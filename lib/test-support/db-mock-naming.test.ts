import { describe, it, expect } from "vitest";
import { join } from "path";
import { findDbNamingViolations } from "./db-mock-naming";
import { DB_UNSUFFIXED_TEST_FILES } from "./db-unsuffixed-test-files";

// Repo root is two directories up from lib/test-support/.
const REPO_ROOT = join(__dirname, "..", "..");

describe("every test file touching the real database is named or listed so it gets checked", () => {
  it("has no unmocked @/lib/db import outside *.integration.test.ts or DB_UNSUFFIXED_TEST_FILES", () => {
    const { violations, filesScanned } = findDbNamingViolations(REPO_ROOT, DB_UNSUFFIXED_TEST_FILES);

    // A number, not a presence check: a glob that silently matched zero files would make
    // this pass having examined nothing. 100+ is a floor, not a pin — this repo's unit +
    // integration suite was ~210 files at the time this check was written.
    expect(filesScanned).toBeGreaterThan(100);

    if (violations.length > 0) {
      const lines = violations.map((v) => `  - ${v.file}\n      ${v.reason}`);
      throw new Error(
        `${violations.length} test file(s) touch the real database with no reachability check:\n` +
          lines.join("\n") +
          `\n\nFix: either rename to *.integration.test.ts, or add the path to ` +
          `DB_UNSUFFIXED_TEST_FILES in vitest.config.ts (and keep this list exact — ` +
          `every entry there is routed to the "integration-unsuffixed" project, which gets ` +
          `db-preflight.ts's reachability check the same as "integration").`,
      );
    }

    expect(violations).toEqual([]);
  });
});
