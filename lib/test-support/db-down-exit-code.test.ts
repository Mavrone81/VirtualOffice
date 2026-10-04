import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

// This is the single most important property of db-preflight.ts, stated as code instead of
// a log pasted into a report: a run against an unreachable database must exit non-zero and
// must NOT print a passed/failed/skipped summary line — "ran, and reported counts" is
// exactly the shape that let 423 real failures read as a survivable partial pass before this
// fix. "exits non-zero" alone is not enough to prove either: a process can exit 1 while still
// printing a summary that reads as mostly-green (see db-preflight.ts's own comment for the
// measured 421-skipped case this is written against), so both are asserted here, not one.
//
// Spawns a REAL vitest subprocess (not an in-process call) against a dead DATABASE_URL, so
// this exercises the actual CLI entry point a developer or CI runs, not just the exported
// dbPreflight() function (lib/test-support/db-preflight.test.ts covers that function
// directly; this test covers what happens when vitest's own startup sequence calls it).
const DEAD_DATABASE_URL = "postgresql://nouser:nopass@127.0.0.1:1/nodb";

describe("a run against an unreachable database", () => {
  it("exits non-zero and prints no pass/fail/skip summary — fails loud, not partial", () => {
    const result = spawnSync(
      "npx",
      ["vitest", "run", "--project", "integration"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        // Correct behavior (preflight aborts before collecting anything) measured at ~11s
        // wall time in this sandbox, almost entirely `npx` resolution overhead, not vitest's
        // own logic. 15s leaves margin for that without being so long a genuinely broken,
        // still-running process (see the `signal` assertion below) blocks this test for
        // minutes; either way, `signal` being non-null is what actually catches it, not this
        // number.
        timeout: 15_000,
        env: {
          ...process.env,
          DATABASE_URL: DEAD_DATABASE_URL,
          AUTH_SECRET: "db-down-exit-code-test-only",
          PII_ENCRYPTION_KEY: "a".repeat(64),
        },
      },
    );

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    // Caught by hand while writing this test: spawnSync's `timeout` kills the process with
    // SIGTERM on expiry, which leaves `status: null` (not 0) and whatever partial output had
    // already streamed — satisfying a bare "exit code isn't 0" check and even a loose content
    // check for the WRONG reason (a slow, still-running process that never actually reached a
    // real exit). Measured directly: with the preflight's own throw disabled, the process does
    // not hang on one connection attempt — each of the 70 integration files discovers the dead
    // database on its own and the whole run eventually fails for real, but only after multiple
    // minutes (70 files' worth of individual connection attempts instead of one upfront check),
    // which a CI-reasonable timeout here would never wait for. So `signal` must be asserted
    // explicitly: non-null means killed, not a genuine fast exit, and the test must treat that
    // as a failure of the thing under test, not evidence for it.
    expect(
      result.signal,
      `process was killed (signal=${result.signal}) rather than exiting on its own — ` +
        `it did not fail fast. Output:\n${output}`,
    ).toBeNull();
    expect(result.status, `expected non-zero exit; got ${result.status}. Output:\n${output}`).not.toBe(0);
    expect(output).toContain("DATABASE PREFLIGHT FAILED");
    // The exact shape this fix exists to prevent: a run that collected and reported counts
    // (however bad) instead of refusing to start. No "Test Files"/"Tests" summary line means
    // nothing was collected — not even a failing collection.
    expect(output).not.toMatch(/Test Files\s+\d+/);
    expect(output).not.toMatch(/Tests\s+\d+/);
  }, 20_000);
});
