import { describe, it, expect, afterEach, vi } from "vitest";

// Every other MARKETING_LIBRARY_ENABLED test in this repo mocks @/lib/env
// directly (vi.mock("@/lib/env", ...)) — standard, deliberate practice for
// unit tests, same as 20+ other env-dependent suites here, but it means
// NONE of them ever runs a real process.env string through the actual zod
// schema for this specific key. A flag-ON test built that way would still
// pass even if the flag were declared somewhere the schema never reads (it
// nearly was — see lib/env.ts's own history). This is the one test that
// imports the real, unmocked module and proves the flag parses the way a
// real deploy's env var actually would.
const ORIGINAL = process.env.MARKETING_LIBRARY_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MARKETING_LIBRARY_ENABLED;
  else process.env.MARKETING_LIBRARY_ENABLED = ORIGINAL;
  vi.resetModules();
});

async function loadEnv() {
  vi.resetModules();
  const { env } = await import("@/lib/env");
  return env;
}

describe("MARKETING_LIBRARY_ENABLED — parses through the REAL schema, not a mock", () => {
  it('"true" (exactly what a real .env/shell export supplies) parses to true', async () => {
    process.env.MARKETING_LIBRARY_ENABLED = "true";
    const env = await loadEnv();
    expect(env.MARKETING_LIBRARY_ENABLED).toBe(true);
  });

  it("unset defaults to false (ships disabled)", async () => {
    delete process.env.MARKETING_LIBRARY_ENABLED;
    const env = await loadEnv();
    expect(env.MARKETING_LIBRARY_ENABLED).toBe(false);
  });

  // CONTROL: proves the preprocessor is strict, not merely "truthy string
  // wins" — matches the same documented convention as A17_CLOSED_DEAL_FLOW
  // ("anything unset or unparseable is OFF, never a silent enable"). If
  // this ever read true, a typo'd env var ("True", "1", "yes") would
  // silently enable the feature in production.
  it('CONTROL: a near-miss value ("True", capitalised) does NOT parse to true', async () => {
    process.env.MARKETING_LIBRARY_ENABLED = "True";
    const env = await loadEnv();
    expect(env.MARKETING_LIBRARY_ENABLED).toBe(false);
  });

  it('CONTROL: "1" does NOT parse to true', async () => {
    process.env.MARKETING_LIBRARY_ENABLED = "1";
    const env = await loadEnv();
    expect(env.MARKETING_LIBRARY_ENABLED).toBe(false);
  });
});
