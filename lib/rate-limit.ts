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
  const existing = await prisma.rateLimitAttempt.findUnique({
    where: { identifier_action: { identifier, action } },
  });

  const windowElapsed = !existing || now.getTime() - existing.windowStart.getTime() >= WINDOW_MS;
  const nextCount = windowElapsed ? 1 : existing!.count + 1;
  const nextWindowStart = windowElapsed ? now : existing!.windowStart;
  const shouldLock = nextCount >= LIMITS[action];
  const nextLockedUntil = shouldLock ? new Date(now.getTime() + LOCKOUT_MS) : null;

  await prisma.rateLimitAttempt.upsert({
    where: { identifier_action: { identifier, action } },
    create: {
      identifier,
      action,
      windowStart: nextWindowStart,
      count: shouldLock ? 0 : nextCount,
      lockedUntil: nextLockedUntil,
    },
    update: {
      windowStart: nextWindowStart,
      count: shouldLock ? 0 : nextCount,
      lockedUntil: nextLockedUntil,
    },
  });
}

export async function recordSuccess(identifier: string, action: RateAction): Promise<void> {
  await prisma.rateLimitAttempt.deleteMany({ where: { identifier, action } });
}
