import type { Reporter } from "vitest/node";

/** Makes "a file collected NO tests" an unmissable line in the summary.
 *
 *  🔴 Why this is not a test-count floor. A floor ("fail under 900 tests") needs a magic number
 *  that is wrong the moment anyone adds or removes a test, and a number that keeps going red for
 *  the wrong reason gets raised until it stops firing. **A test file that collected ZERO tests is
 *  structural** — it means the file failed to import, not that it had nothing to say. There is no
 *  threshold to maintain and nothing to tune.
 *
 *  What it is for: three different causes produced the same misleading shape in a single evening —
 *  a required environment variable absent, another present but two characters short of its
 *  minimum, and a missing generated database client. Each time the run reported something like
 *  `Test Files 128 failed | 21 passed` with `Tests 8 failed | 297 passed`, and each time that last
 *  line read like a handful of ordinary failures while most of the suite had never executed.
 *  Vitest does print `(0 test)` per file — but it prints it 128 times, scrolled far above a total
 *  that looks survivable.
 *
 *  lib/test-support/env-preflight.ts stops the commonest cause before the run starts. This reporter is the
 *  general case: it does not care WHY a file collected nothing.
 */
export default class ZeroCollectedReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<{ moduleId: string; children: { allTests(): Iterable<unknown> } }> = []) {
    let total = 0;
    const empty: string[] = [];
    for (const m of modules) {
      let n = 0;
      try {
        // `allTests()` is a bare iterable — no `length`/`size` — so materialise it to count.
        // Counting with `for (const _ of …)` needs a binding the loop never reads, which eslint
        // reports as an unused variable; the repo has no `varsIgnorePattern` for `_`, so avoid
        // the binding rather than add a shared-config exception for one call site.
        n = Array.from(m.children.allTests()).length;
      } catch {
        n = 0; // a module too broken to enumerate is, for our purposes, a module that collected nothing
      }
      total += n;
      if (n === 0) empty.push(m.moduleId);
    }

    // Printed on every run, pass or fail. A silent reporter and an absent reporter look identical,
    // so it states how many modules it actually consumed — that is its own built-in control.
    process.stdout.write(
      `\ncollection check: ${modules.length} module(s) consumed, ${total} test(s) collected, ` +
        `${empty.length} module(s) collected 0 tests\n`,
    );
    if (empty.length === 0) return;

    const rel = (p: string) => p.replace(`${process.cwd()}/`, "");
    process.stderr.write(
      [
        "",
        "=".repeat(78),
        `${empty.length} TEST FILE(S) COLLECTED ZERO TESTS — they did not run, they failed to load.`,
        "",
        "Read this BEFORE the pass/fail totals above. Those totals are counted only over the tests",
        "that were collected, so they can look survivable while most of the suite never executed.",
        "A run in this state has not measured what you think it measured.",
        "",
        "Files that collected nothing:",
        ...empty.slice(0, 15).map((p) => `  - ${rel(p)}`),
        ...(empty.length > 15 ? [`  ... and ${empty.length - 15} more`] : []),
        "",
        "Commonest causes, in the order they have actually bitten us:",
        "  1. the environment does not satisfy lib/env-schema.ts  ->  pnpm check:env",
        "  2. the generated database client is missing            ->  npx prisma generate",
        "  3. an import throws at module scope in a shared helper",
        "=".repeat(78),
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
  }
}
