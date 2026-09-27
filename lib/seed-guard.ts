// SEC-3/SEC-4: prisma/seed.ts has no hardcoded password of its own — the
// caller must always supply a real SEED_PASSWORD, in every environment,
// dev included. Pure/testable on purpose: prisma/seed.ts is a script, not
// covered by vitest's include globs, so the decision logic lives here
// instead.
//
// DevSecOps review follow-up: an earlier version allow-listed a public
// fallback default for provably-local DATABASE_URLs (G1/G2). That fallback
// is gone — it bought local convenience at the cost of a shared password
// value sitting in a public repo, and a developer who wants that
// convenience can put SEED_PASSWORD in their own .env.local (see
// .env.example). This is now unconditional: no password, no seed, anywhere.
export const MIN_SEED_PASSWORD_LENGTH = 12;

export function seedGuardError(env: { seedPassword?: string }): string | null {
  // Empty string doesn't count as supplied — that's "nothing set", not a
  // real override (G2).
  if (!env.seedPassword) {
    return "SEED_PASSWORD is required — set it in your shell (or .env, see .env.example) before running the seed script.";
  }
  if (env.seedPassword.length < MIN_SEED_PASSWORD_LENGTH) {
    return `SEED_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
