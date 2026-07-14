import { randomBytes } from "crypto";

/**
 * Generate a per-user, cryptographically-random temporary password.
 * Used when provisioning a new login or when an admin resets a password;
 * the user is forced to change it on first login (User.mustResetPassword).
 * 12 url-safe chars from 9 random bytes (~72 bits of entropy).
 */
export function generateTempPassword(): string {
  return randomBytes(9).toString("base64url");
}
