import { envSchema } from "../lib/env-schema";

/** Vitest globalSetup: validate the environment ONCE, loudly, before any worker starts.
 *
 *  🔴 The problem this solves is not a missing variable — it is a quiet one. lib/env.ts
 *  validates at import and throws, which is correct and deliberate: a copied .env must fail
 *  closed rather than boot with a publicly-known secret. But when that throw happens inside a
 *  test run it lands once per test FILE, so the run reports e.g.
 *
 *      Test Files  128 failed | 21 passed (149)
 *           Tests  8 failed | 297 passed (305)
 *
 *  with 128 files showing "(0 test)". 698 tests never ran, and the summary line reads like a
 *  survivable 8 failures. Two separate provisioning mistakes produced exactly that shape in one
 *  evening — one variable absent, one present but two characters too short — and both cost real
 *  time to diagnose, because the number on the last line looked plausible.
 *
 *  A run that cannot validate its environment has measured nothing, so it must stop and say so
 *  once, naming every offending variable, instead of failing 128 times and reporting a count.
 */
export default function envPreflight() {
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success) return;

  const byPath = new Map<string, string[]>();
  for (const issue of parsed.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "(root)";
    byPath.set(key, [...(byPath.get(key) ?? []), issue.message]);
  }
  const lines = [...byPath.entries()].map(([k, v]) => `${k}: ${v.join("; ")}`).sort();

  const banner = [
    "",
    "=".repeat(78),
    "ENVIRONMENT PREFLIGHT FAILED — the test run is stopping before it starts.",
    "",
    `${lines.length} variable(s) do not satisfy the contract in lib/env-schema.ts:`,
    ...lines.map((l) => `  - ${l}`),
    "",
    "Nothing has been measured. Had this run continued, every test file that imports",
    "the app's env would have collected 0 tests, and the summary would have reported a",
    "plausible-looking partial pass instead of this.",
    "",
    "Fix: copy .env.example to .env and set the required values. Then check it with",
    "  pnpm check:env",
    "which reports exactly which variables a fresh copy still needs.",
    "=".repeat(78),
    "",
  ].join("\n");

  console.error(banner);
  throw new Error(`Environment preflight failed: ${lines.join(" | ")}`);
}
