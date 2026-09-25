import type { AppRole } from "@prisma/client";
import type { JWT } from "next-auth/jwt";

// SEC-2: the JWT used to be a sign-in snapshot — deactivating, terminating or
// demoting a user had no effect on a session they already held (and Auth.js
// sessions roll forward on use). On every Node-side `auth()` we now re-read the
// user's live state and either refresh the claims or end the session.

/** The live, authorization-relevant state of a login. */
export type LiveUser = {
  isActive: boolean;
  role: AppRole;
  associateId: string | null;
  mustResetPassword: boolean;
};

/** Re-check at most this often per token. Bounds DB load; a revoked user loses access within this window. */
export const REVALIDATE_MS = 60_000;

/**
 * Returns the refreshed token, or `null` to end the session (Auth.js treats a
 * null JWT as signed out). `load` is injected so this stays unit-testable.
 * Fails CLOSED: a token without a subject, a missing/inactive user, or a
 * lookup error all end the session.
 */
export async function revalidateToken(
  token: JWT,
  load: (userId: string) => Promise<LiveUser | null>,
  now: number = Date.now(),
): Promise<JWT | null> {
  if (!token.sub) return null;
  if (typeof token.chk === "number" && now - token.chk < REVALIDATE_MS) return token;

  let live: LiveUser | null;
  try {
    live = await load(token.sub);
  } catch {
    return null;
  }
  if (!live || !live.isActive) return null;

  return {
    ...token,
    role: live.role,
    associateId: live.associateId,
    mustResetPassword: live.mustResetPassword,
    chk: now,
  };
}
