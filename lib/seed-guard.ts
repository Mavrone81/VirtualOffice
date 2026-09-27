// SEC-3/SEC-4: refuse to seed anything that isn't provably local unless the
// caller supplies a real SEED_PASSWORD — the fallback default in
// prisma/seed.ts is public (it's committed in this repo). Pure/testable on
// purpose: prisma/seed.ts is a script, not covered by vitest's include
// globs, so the decision logic lives here instead.
//
// DevSecOps review (reviews/seed-guard-devsecops-review.md, G1): an earlier
// version keyed this on NODE_ENV=production, but the documented prod seed
// path (docker-compose.prod.yml's builder/migrator target) never sets
// NODE_ENV — that failed OPEN. This is an allow-list for the fallback (only
// when DATABASE_URL is provably local), not a block-list for production, so
// it fails closed regardless of what NODE_ENV is or isn't set to. NODE_ENV
// is still checked too, belt-and-braces, but the DB host is what matters.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export const MIN_SEED_PASSWORD_LENGTH = 12;

export function seedGuardError(env: { nodeEnv?: string; databaseUrl?: string; seedPassword?: string }): string | null {
  // A password was explicitly supplied (empty string doesn't count — that's
  // "nothing supplied", not a real override; G2) — enforce a length floor
  // regardless of whether the target looks local, so a weak override can't
  // slip through either way.
  if (env.seedPassword && env.seedPassword.length < MIN_SEED_PASSWORD_LENGTH) {
    return `SEED_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters.`;
  }
  if (env.seedPassword) return null;
  if (env.nodeEnv !== "production" && isLocalDatabaseUrl(env.databaseUrl)) return null;
  return "SEED_PASSWORD must be set unless seeding a local database — the fallback default is public.";
}

function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false; // no DATABASE_URL at all is not itself proof of a local target — fail closed
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
