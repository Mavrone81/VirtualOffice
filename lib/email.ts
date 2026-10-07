/**
 * The canonical stored form of an email address.
 *
 * Why this exists: login looks a user up with `email.toLowerCase().trim()`,
 * but the write paths stored whatever was typed. PostgreSQL comparison is
 * case-sensitive, so an address saved as `Louisewsf@gmail.com` could never be
 * found by a login attempt — and the failure is maximally confusing, because
 * everything else about the account is fine. The password is right, the user is
 * active, an admin can reset the password successfully, and the person still
 * cannot get in. On 2026-10-07 this had silently locked out 5 of 25 users.
 *
 * Mail domains are case-insensitive in practice and the local part is
 * case-sensitive only in theory, which no mainstream provider honours — so
 * lowercasing the whole address is safe and is what the login path already
 * assumed everyone else was doing.
 */
export function normalizeEmail<T extends string | null | undefined>(email: T): T extends string ? string : null {
  const v = email?.trim().toLowerCase();
  return (v ? v : null) as T extends string ? string : null;
}
