import { prisma } from "@/lib/db";

// DB-backed rate-limit + lockout service (Phase 1d §4.2).
// Fail-open on infra error (a DB hiccup must not lock everyone out);
// fail-closed once a real lockout is active.

export type RateAction = "login" | "password_reset" | "onboard_submit" | "esign_submit";

export const LIMITS: Record<RateAction, number> = {
  login: 5,
  password_reset: 5,
  onboard_submit: 10,
  esign_submit: 10,
};

export const WINDOW_MS = 15 * 60_000;
export const LOCKOUT_MS = 15 * 60_000;

export async function checkRateLimit(
  identifier: string,
  action: RateAction,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  try {
    const row = await prisma.rateLimitAttempt.findUnique({
      where: { identifier_action: { identifier, action } },
    });
    if (row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
      const retryAfterSec = Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000);
      return { allowed: false, retryAfterSec };
    }
    return { allowed: true };
  } catch (err) {
    // Fail-open: an infra error must not lock legitimate users out.
    console.error("[rate-limit] checkRateLimit DB error — failing open", { identifier, action, err });
    return { allowed: true };
  }
}

export async function recordFailure(identifier: string, action: RateAction): Promise<void> {
  const now = new Date();
  const limit = LIMITS[action];
  // Precompute the two timestamps that don't depend on the existing row so
  // the SQL below only has to branch on `r.window_start < windowThreshold`
  // and `<candidate count> >= limit` — no interval arithmetic in SQL.
  const windowThreshold = new Date(now.getTime() - WINDOW_MS);
  const lockedUntilIfLocked = new Date(now.getTime() + LOCKOUT_MS);

  // Atomic upsert: a single statement so N concurrent failures for the same
  // (identifier, action) cannot each read the same stale count and clobber
  // each other (that race would let a concurrent credential-stuffing burst
  // bypass the lockout). The nested CASE below reproduces, branch-for-branch,
  // the same "reset on elapsed window, else increment; lock at limit" logic
  // the previous findUnique-then-upsert implementation had — but evaluated as
  // a single INSERT ... ON CONFLICT ... DO UPDATE, atomic under Postgres's
  // per-row lock taken for the conflicting update.
  //
  // nextCountRaw  = elapsed ? 1 : r.count + 1
  // shouldLock    = nextCountRaw >= limit
  // final count       = shouldLock ? 0 : nextCountRaw
  // final window_start= elapsed ? now : r.window_start
  // final locked_until= shouldLock ? now+LOCKOUT_MS : (elapsed ? NULL : r.locked_until)
  await prisma.$executeRaw`
    INSERT INTO rate_limit_attempts AS r
      (id, identifier, action, window_start, count, locked_until, updated_at)
    VALUES
      (
        gen_random_uuid(), ${identifier}, ${action}, ${now},
        CASE WHEN 1 >= ${limit} THEN 0 ELSE 1 END,
        CASE WHEN 1 >= ${limit} THEN ${lockedUntilIfLocked} ELSE NULL END,
        ${now}
      )
    ON CONFLICT (identifier, action) DO UPDATE SET
      window_start = CASE
        WHEN r.window_start < ${windowThreshold} THEN ${now}
        ELSE r.window_start
      END,
      count = CASE
        WHEN (CASE WHEN r.window_start < ${windowThreshold} THEN 1 ELSE r.count + 1 END) >= ${limit}
          THEN 0
        ELSE (CASE WHEN r.window_start < ${windowThreshold} THEN 1 ELSE r.count + 1 END)
      END,
      locked_until = CASE
        WHEN (CASE WHEN r.window_start < ${windowThreshold} THEN 1 ELSE r.count + 1 END) >= ${limit}
          THEN ${lockedUntilIfLocked}
        WHEN r.window_start < ${windowThreshold} THEN NULL
        ELSE r.locked_until
      END,
      updated_at = ${now}
  `;
}

export async function recordSuccess(identifier: string, action: RateAction): Promise<void> {
  await prisma.rateLimitAttempt.deleteMany({ where: { identifier, action } });
}
