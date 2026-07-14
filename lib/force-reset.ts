// Edge-safe (no Prisma / no native modules) — imported by middleware.
// A logged-in user whose password was provisioned or admin-reset carries
// mustResetPassword=true in their JWT; they must be sent to the force-reset
// screen before any other authed page renders, until they set a new password.

export const FORCE_RESET_PATH = "/force-password-reset";

export function shouldForceReset(args: {
  isLoggedIn: boolean;
  mustReset: boolean;
  pathname: string;
}): boolean {
  const { isLoggedIn, mustReset, pathname } = args;
  if (!isLoggedIn || !mustReset) return false;
  // Already on the force-reset page — don't redirect onto itself.
  if (pathname === FORCE_RESET_PATH) return false;
  return true;
}
