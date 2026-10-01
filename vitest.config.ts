import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Tests read the app's env (lib/env.ts validates the FULL schema at import).
// Load .env deterministically here, once, before any worker starts, instead of
// relying on @prisma/client's import side effect (which made env-dependent tests
// pass or fail depending on import order). Node's loader never overrides a
// variable that's already set, so CI's job-level env and anything exported in
// the shell still win; with no .env file (CI) this is a no-op.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: rely on the environment as given
}

// M5-CF exposed a real gap: integration tests share one throwaway Postgres and
// relied on each file picking a different literal month for isolation. CF's
// cross-month queries (payoutMonth <= M) don't respect that convention — a run in
// one file can now see another file's fixtures at an earlier month. Rather than
// try to keep every file's month range non-overlapping forever, run integration
// tests sequentially (one file at a time); unit tests still run in parallel.
export default defineConfig({
  plugins: [tsconfigPaths()],
  // tsconfig.json sets "jsx": "preserve" for Next's own compiler, and that leaks
  // into the test runner, which then chokes on raw JSX the moment a test imports
  // a real .tsx module (the PDF templates: A-7's voucher, SEC-12's byte-identity
  // check). Vite 8 transforms with oxc (esbuild options are ignored), so set the JSX
  // runtime there. Reconciled from A-7 (Backend) and SEC-12 (Database): one config.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    // Validate the environment ONCE here rather than letting lib/env.ts throw separately in
    // every test file. See lib/test-support/env-preflight.ts: the per-file throw turns a deliberate
    // fail-closed into a summary that reads like a partial pass, hiding how many tests never
    // ran. globalSetup applies to every project below.
    globalSetup: ["./lib/test-support/env-preflight.ts"],
    // A file that collects 0 tests failed to LOAD; it did not run and report nothing. Vitest
    // prints "(0 test)" per file, but 100+ of those scroll above a total that reads as a few
    // ordinary failures. This surfaces the count as one line. See lib/test-support/zero-collected-reporter.ts.
    reporters: ["default", "./lib/test-support/zero-collected-reporter.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["server/**/*.test.ts", "lib/**/*.test.ts"],
          exclude: ["server/**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["server/**/*.integration.test.ts"],
          fileParallelism: false,
          // No project-level testTimeout existed anywhere in this file, so
          // every integration test ran on vitest's bare 5000ms default —
          // fine for a quiet box, not for real DB/PDF work under the load
          // this repo's integration suite regularly sees (sequential by
          // design, above). 30s absorbs normal contention-driven slowness
          // without being so long a genuinely hung test blocks the run for
          // minutes; the 17 existing per-test overrides (10s-120s) still
          // win where they're set, unchanged by this. hookTimeout matches:
          // a beforeAll doing the same DB/fixture work had the identical
          // 5000ms budget, and a hook timeout reads as a different, more
          // confusing failure than a test timeout.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
