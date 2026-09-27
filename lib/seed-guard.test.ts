import { describe, it, expect } from "vitest";
import { seedGuardError, MIN_SEED_PASSWORD_LENGTH } from "./seed-guard";

const LOCAL = "postgresql://virtualoffice:pw@localhost:10501/virtualoffice";
const LOCAL_IP = "postgresql://virtualoffice:pw@127.0.0.1:10501/virtualoffice";
const LOCAL_V6 = "postgresql://virtualoffice:pw@[::1]:10501/virtualoffice";
// The prod compose network's own DB hostname (docker-compose.prod.yml's `db`
// service) — deliberately NOT on the allow-list; see DevSecOps's G1 review.
const REMOTE = "postgresql://user:pw@db:5432/virtualoffice";
const strongPassword = "a-real-secret-12+";

describe("seedGuardError — allow-list the fallback for provably-local targets only (DevSecOps G1)", () => {
  it("allows a local DATABASE_URL (localhost) with no SEED_PASSWORD", () => {
    expect(seedGuardError({ databaseUrl: LOCAL })).toBeNull();
  });

  it("allows a local DATABASE_URL (127.0.0.1) with no SEED_PASSWORD", () => {
    expect(seedGuardError({ databaseUrl: LOCAL_IP })).toBeNull();
  });

  it("allows a local DATABASE_URL (IPv6 loopback) with no SEED_PASSWORD", () => {
    expect(seedGuardError({ databaseUrl: LOCAL_V6 })).toBeNull();
  });

  it("refuses a remote-looking DATABASE_URL (the prod compose's own 'db' hostname) with no SEED_PASSWORD", () => {
    expect(seedGuardError({ databaseUrl: REMOTE })).toMatch(/SEED_PASSWORD must be set/);
  });

  it("refuses when DATABASE_URL is missing entirely — fail closed, not proof of local", () => {
    expect(seedGuardError({})).toMatch(/SEED_PASSWORD must be set/);
  });

  it("refuses when DATABASE_URL is unparseable — fail closed", () => {
    expect(seedGuardError({ databaseUrl: "not a url" })).toMatch(/SEED_PASSWORD must be set/);
  });

  it("allows a remote DATABASE_URL when a strong SEED_PASSWORD is supplied", () => {
    expect(seedGuardError({ databaseUrl: REMOTE, seedPassword: strongPassword })).toBeNull();
  });

  it("refuses a remote DATABASE_URL even with NODE_ENV unset (the documented prod seed path never sets it — G1)", () => {
    expect(seedGuardError({ nodeEnv: undefined, databaseUrl: REMOTE })).toMatch(/SEED_PASSWORD must be set/);
  });

  it("belt-and-braces: refuses NODE_ENV=production even on a local-looking DATABASE_URL", () => {
    expect(seedGuardError({ nodeEnv: "production", databaseUrl: LOCAL })).toMatch(/SEED_PASSWORD must be set/);
  });

  it(`refuses a supplied SEED_PASSWORD shorter than ${MIN_SEED_PASSWORD_LENGTH} chars, even for a remote target`, () => {
    expect(seedGuardError({ databaseUrl: REMOTE, seedPassword: "short" })).toMatch(/at least 12 characters/);
  });

  it(`refuses a short SEED_PASSWORD on a LOCAL target too (G2 — no weak floor either way)`, () => {
    expect(seedGuardError({ databaseUrl: LOCAL, seedPassword: "short" })).toMatch(/at least 12 characters/);
  });

  it("treats an empty-string SEED_PASSWORD as not supplied (G2) — falls back to the local/remote check, not hashed as-is", () => {
    expect(seedGuardError({ databaseUrl: LOCAL, seedPassword: "" })).toBeNull();
    expect(seedGuardError({ databaseUrl: REMOTE, seedPassword: "" })).toMatch(/SEED_PASSWORD must be set/);
  });

  it("the refusal message never echoes any password value", () => {
    const r = seedGuardError({ databaseUrl: REMOTE });
    expect(r).not.toContain("Seed-Dev-Only");
  });
});
