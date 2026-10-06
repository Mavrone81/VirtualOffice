import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { DB_UNSUFFIXED_TEST_FILES } from "./lib/test-support/db-unsuffixed-test-files";

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
    // ran. Each project below lists its own globalSetup explicitly (rather than relying on
    // inheriting this one) so there is no ambiguity about which checks run where.
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
          // The bare `lib/**/*.test.ts` include above also matches
          // `lib/**/*.integration.test.ts` (a `*` eats "agreement.integration"
          // same as it eats "agreement"), so that glob needs its own exclude
          // here — the server/**/*.integration.test.ts exclude below it does
          // NOT reach lib/ at all. Two PDF tests that shell out to
          // pdftoppm/pdftotext/pdfinfo/gs (lib/pdf/agreement.integration.test.ts,
          // lib/pdf/agreement-circle-ink-intersection.integration.test.ts, both
          // renamed by this change) were misfiled
          // here as a result — unit's 5000ms default, no fileParallelism:false,
          // competing 8-way with genuine unit tests. Renaming alone is a
          // verified no-op without this exclude (and the matching include
          // below): confirmed via `npx vitest list --project <name>` before
          // trusting a green run, since a file matching no glob collects and
          // reports nothing.
          //
          // DB_UNSUFFIXED_TEST_FILES (imported above, from lib/test-support/) is excluded too: those files keep
          // @/lib/db real (no vi.mock) despite being named `*.test.ts`, not
          // `*.integration.test.ts` — see that constant's own comment. They run
          // under the "integration-unsuffixed" project instead, which is the
          // only one that gets db-preflight's reachability check: a file that
          // hits the real database but isn't in either of this file's two
          // integration-named globs would otherwise run under "unit" with no
          // DB check at all, and fail inside its own beforeAll exactly the way
          // db-preflight.ts exists to prevent (see that file's comment).
          exclude: ["server/**/*.integration.test.ts", "lib/**/*.integration.test.ts", ...DB_UNSUFFIXED_TEST_FILES],
          globalSetup: ["./lib/test-support/env-preflight.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["server/**/*.integration.test.ts", "lib/**/*.integration.test.ts"],
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
          // lib/test-support/db-preflight.ts: prove Postgres is actually
          // reachable ONCE, before any file in this project loads, instead of
          // letting each file's own beforeAll find out — which vitest reports
          // as every test in that file SKIPPED, not FAILED. See that file's
          // comment for what was measured without it.
          globalSetup: ["./lib/test-support/env-preflight.ts", "./lib/test-support/db-preflight.ts"],
        },
      },
      {
        extends: true,
        test: {
          // Same database, same preflight, same sequential/30s treatment as "integration" —
          // the only difference is which files are in scope. These keep @/lib/db real but
          // are named plain `*.test.ts`, so neither integration glob above ever matched them;
          // left alone they'd run under "unit" with no DB check and no sequential isolation.
          // See lib/test-support/db-unsuffixed-test-files.ts for how this list was found,
          // and lib/test-support/db-mock-naming.test.ts for the permanent check that a
          // 13th such file can't join silently. Not renamed to
          // `*.integration.test.ts` in this change — that's a naming-convention call for
          // the team to make, not bundled into a test-honesty fix.
          name: "integration-unsuffixed",
          include: DB_UNSUFFIXED_TEST_FILES,
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
          globalSetup: ["./lib/test-support/env-preflight.ts", "./lib/test-support/db-preflight.ts"],
        },
      },
      {
        extends: true,
        test: {
          // First component-render tests in this repo: the other projects' tests
          // call a Server Component as a plain function and walk its returned
          // element tree (e.g. server/team/performance-page.test.ts) — that works
          // because an async Server Component is just a function returning
          // elements. A CLIENT component using hooks (useState/useTransition) is
          // not: calling it directly throws "invalid hook call" with no React
          // dispatcher installed, so proving a refusal message actually reaches
          // the screen (not just the action's return value) needs a real DOM and
          // a real render pass — environment: "jsdom", not "node", and
          // @testing-library/react rather than calling the function by hand.
          // Own project rather than folding into "unit" so "unit" stays exactly
          // as fast and dependency-light as it already is for every other file.
          name: "components",
          environment: "jsdom",
          include: ["app/**/*.test.tsx", "components/**/*.test.tsx"],
          globalSetup: ["./lib/test-support/env-preflight.ts"],
        },
      },
    ],
  },
});
