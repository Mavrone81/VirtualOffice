"use server";

import { randomBytes, createHash } from "crypto";
import { hash, verify } from "@node-rs/argon2";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { sendMail, resetPasswordEmail } from "@/lib/mail";

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
  const e = email?.trim().toLowerCase();
  if (e) {
    const user = await prisma.user.findUnique({ where: { email: e } });
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
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(newPassword), resetTokenHash: null, resetTokenExpiresAt: null },
  });
  await logAudit({ action: "password.reset_self", entityType: "User", entityId: user.id, actorUserId: user.id });
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

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(newPassword) } });
  await logAudit({ action: "password.changed", entityType: "User", entityId: user.id, actorUserId: user.id });
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

  const tempPassword = `En-${randomBytes(4).toString("hex")}`; // e.g. En-9f3a2b7c
  await prisma.user.update({ where: { id: assoc.user.id }, data: { passwordHash: await hash(tempPassword) } });
  await logAudit({ action: "password.reset_by_admin", entityType: "User", entityId: assoc.user.id, actorUserId: session.user.id, after: { associateId } });
  return { ok: true, tempPassword };
}
