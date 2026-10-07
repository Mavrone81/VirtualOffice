"use server";

import { randomBytes, createHash } from "crypto";
import { hash, verify } from "@node-rs/argon2";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { can } from "@/lib/rbac";
import { auditTx, AuditWriteError } from "@/lib/audit";
import { sendMail, resetPasswordEmail } from "@/lib/mail";
import { generateTempPassword } from "@/lib/temp-password";
import { checkRateLimit, recordFailure } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/email";

const MIN_LEN = 8;

async function baseUrl(): Promise<string> {
  if (env.AUTH_URL) return env.AUTH_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

/**
 * Public: request a password reset. Always returns ok (no account enumeration).
 * When the email matches an active user, a one-hour reset link is emailed.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  const normalizedEmail = normalizeEmail(email);
  const id = normalizedEmail ?? "";
  // Rate-limit BEFORE any DB lookup. Mirrors the login pattern in auth.ts:
  // when already blocked, return immediately WITHOUT calling recordFailure.
  // (WINDOW_MS === LOCKOUT_MS, so an unconditional recordFailure while
  // already locked would hit the atomic SQL's "window elapsed" branch and
  // reset the counter + clear locked_until — silently discarding the
  // lockout.) On lockout, return the SAME neutral { ok: true } the success
  // path already returns — this must never become an enumeration oracle (a
  // different response would reveal that the rate limiter engaged, which
  // correlates with a real account existing).
  if (!(await checkRateLimit(id, "password_reset")).allowed) return { ok: true };
  // Every non-blocked reset request counts toward the limit — whether or
  // not the email matches a real account — so an attacker can't distinguish
  // "no such user" from attempt-counting behavior either.
  await recordFailure(id, "password_reset");
  if (normalizedEmail) {
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (user?.isActive) {
      const token = randomBytes(32).toString("base64url");
      await prisma.user.update({
        where: { id: user.id },
        data: { resetTokenHash: sha256(token), resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      await sendMail({ ...resetPasswordEmail(`${await baseUrl()}/reset-password/${token}`), to: user.email });
    }
  }
  return { ok: true };
}

/** Public: complete a password reset with a valid, unexpired token. */
export async function resetPassword(token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!newPassword || newPassword.length < MIN_LEN) return { ok: false, error: t("newPasswordTooShort", { min: MIN_LEN }) };
  const user = await prisma.user.findFirst({
    where: { resetTokenHash: sha256(token), resetTokenExpiresAt: { gt: new Date() } },
  });
  if (!user) return { ok: false, error: t("resetLinkInvalid") };
  const passwordHash = await hash(newPassword);
  // Tier A (reviews/audit-reliability.md): a security change and its record commit together.
  try {
    await prisma.$transaction(async (db) => {
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null, mustResetPassword: false },
      });
      await auditTx(db, { action: "password.reset_self", entityType: "User", entityId: user.id, actorUserId: user.id });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") }; // the token stays valid: retry
    throw e;
  }
  return { ok: true };
}

/** Self-service password change for the signed-in user. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user) return { ok: false, error: t("notSignedIn") };
  if (!newPassword || newPassword.length < MIN_LEN) return { ok: false, error: t("newPasswordTooShort", { min: MIN_LEN }) };
  if (newPassword === currentPassword) return { ok: false, error: t("passwordSameAsCurrent") };

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { ok: false, error: t("accountNotFound") };

  const ok = await verify(user.passwordHash, currentPassword);
  if (!ok) return { ok: false, error: t("currentPasswordIncorrect") };

  const passwordHash = await hash(newPassword);
  try {
    await prisma.$transaction(async (db) => {
      await db.user.update({ where: { id: user.id }, data: { passwordHash, mustResetPassword: false } });
      await auditTx(db, { action: "password.changed", entityType: "User", entityId: user.id, actorUserId: user.id });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  return { ok: true };
}

/** Admin-only: reset an associate's login to a fresh temporary password (user management — docs/05_RBAC.md §3). */
export async function resetAssociatePassword(associateId: string): Promise<{ ok: boolean; error?: string; tempPassword?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !can(session.user.role, "manage_users")) return { ok: false, error: t("forbidden") };

  const assoc = await prisma.associate.findUnique({ where: { id: associateId }, include: { user: true } });
  if (!assoc) return { ok: false, error: t("associateNotFound") };
  if (!assoc.user) return { ok: false, error: t("noLoginToReset") };

  const tempPassword = generateTempPassword();
  const passwordHash = await hash(tempPassword);
  const userId = assoc.user.id;
  try {
    await prisma.$transaction(async (db) => {
      await db.user.update({ where: { id: userId }, data: { passwordHash, mustResetPassword: true } });
      await auditTx(db, { action: "password.reset_by_admin", entityType: "User", entityId: userId, actorUserId: session.user.id, after: { associateId } });
    });
  } catch (e) {
    // Nothing changed, and the temp password is never shown.
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  return { ok: true, tempPassword };
}

/** How long an admin-issued sign-in link stays valid — long enough to survive
 *  a weekend in a WhatsApp chat, short enough not to be a standing credential. */
const SIGNIN_LINK_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Admin-only: issue a one-time "set your password" link for an associate, to
 * copy and send them directly (WhatsApp etc.) when the welcome email doesn't
 * arrive — or any time later. It reuses the self-service reset token, so it
 * replaces any earlier reset link, works exactly once, and expires in 72h.
 * The admin never sees or chooses the password.
 */
export async function createSignInLink(
  associateId: string,
): Promise<{ ok: boolean; error?: string; url?: string; loginUrl?: string; email?: string; name?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !can(session.user.role, "manage_users")) return { ok: false, error: t("forbidden") };

  const assoc = await prisma.associate.findUnique({ where: { id: associateId }, include: { user: true } });
  if (!assoc) return { ok: false, error: t("associateNotFound") };
  if (!assoc.user || !assoc.user.isActive) return { ok: false, error: t("noLoginToReset") };

  const token = randomBytes(32).toString("base64url");
  const userId = assoc.user.id;
  try {
    // Tier A: a credential issued by an admin and its record commit together.
    await prisma.$transaction(async (db) => {
      await db.user.update({
        where: { id: userId },
        data: { resetTokenHash: sha256(token), resetTokenExpiresAt: new Date(Date.now() + SIGNIN_LINK_TTL_MS) },
      });
      await auditTx(db, { action: "password.signin_link_by_admin", entityType: "User", entityId: userId, actorUserId: session.user.id, after: { associateId } });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") }; // no link issued
    throw e;
  }
  const base = await baseUrl();
  return { ok: true, url: `${base}/reset-password/${token}`, loginUrl: `${base}/login`, email: assoc.user.email, name: assoc.fullName };
}
