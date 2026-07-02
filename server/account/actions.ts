"use server";

import { randomBytes } from "crypto";
import { hash, verify } from "@node-rs/argon2";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

const MIN_LEN = 8;

/** Self-service password change for the signed-in user. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Not signed in." };
  if (!newPassword || newPassword.length < MIN_LEN) return { ok: false, error: `New password must be at least ${MIN_LEN} characters.` };
  if (newPassword === currentPassword) return { ok: false, error: "New password must differ from the current one." };

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { ok: false, error: "Account not found." };

  const ok = await verify(user.passwordHash, currentPassword);
  if (!ok) return { ok: false, error: "Current password is incorrect." };

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(newPassword) } });
  await logAudit({ action: "password.changed", entityType: "User", entityId: user.id, actorUserId: user.id });
  return { ok: true };
}

/** Admin: reset an associate's login to a fresh temporary password (returned to relay). */
export async function resetAssociatePassword(associateId: string): Promise<{ ok: boolean; error?: string; tempPassword?: string }> {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: "Forbidden" };

  const assoc = await prisma.associate.findUnique({ where: { id: associateId }, include: { user: true } });
  if (!assoc) return { ok: false, error: "Associate not found." };
  if (!assoc.user) return { ok: false, error: "This associate has no login to reset." };

  const tempPassword = `En-${randomBytes(4).toString("hex")}`; // e.g. En-9f3a2b7c
  await prisma.user.update({ where: { id: assoc.user.id }, data: { passwordHash: await hash(tempPassword) } });
  await logAudit({ action: "password.reset_by_admin", entityType: "User", entityId: assoc.user.id, actorUserId: session.user.id, after: { associateId } });
  return { ok: true, tempPassword };
}
