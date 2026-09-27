import { describe, it, expect } from "vitest";
import { seedGuardError, MIN_SEED_PASSWORD_LENGTH } from "./seed-guard";

const strongPassword = "a-real-secret-12+";

describe("seedGuardError — SEED_PASSWORD is always required, no local-dev fallback", () => {
  it("refuses when no SEED_PASSWORD is supplied", () => {
    expect(seedGuardError({})).toMatch(/SEED_PASSWORD is required/);
  });

  it("treats an empty-string SEED_PASSWORD as not supplied (G2)", () => {
    expect(seedGuardError({ seedPassword: "" })).toMatch(/SEED_PASSWORD is required/);
  });

  it("allows a strong, explicitly-supplied SEED_PASSWORD", () => {
    expect(seedGuardError({ seedPassword: strongPassword })).toBeNull();
  });

  it(`refuses a supplied SEED_PASSWORD shorter than ${MIN_SEED_PASSWORD_LENGTH} chars (G2 — no weak floor either)`, () => {
    expect(seedGuardError({ seedPassword: "short" })).toMatch(/at least 12 characters/);
  });

  it("the refusal message never echoes a supplied password value", () => {
    const r = seedGuardError({});
    expect(r).not.toContain(strongPassword);
  });
});
