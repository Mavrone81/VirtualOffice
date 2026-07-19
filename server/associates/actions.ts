"use server";

import { revalidatePath } from "next/cache";
import { ApprovalStatus, AssociateStatus, Designation, PaymentMethod, AppRole } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole, isFullAdmin } from "@/lib/rbac";
import { encryptPII } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { decryptPiiAudited, type PiiField } from "@/server/pii";
import { generateTempPassword } from "@/lib/temp-password";
import { validate } from "@/lib/validate";
import { newAssociateSchema } from "@/lib/schemas";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

/**
 * Reveal an associate's masked PII (NRIC / bank account) to a Business Admin on
 * demand. Decrypt happens only on this explicit click and is recorded in the
 * audit trail (`decrypt_pii`, with the field + actor) — not on every page view.
 */
export async function revealAssociatePii(
  associateId: string,
  field: PiiField,
): Promise<{ ok: boolean; value?: string; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) return { ok: false, error: t("forbidden") };

  const a = await prisma.associate.findUnique({
    where: { id: associateId },
    select: { nric: true, bankAccountNumber: true },
  });
  if (!a) return { ok: false, error: t("notFound") };

  const blob = field === "nric" ? a.nric : a.bankAccountNumber;
  const value = await decryptPiiAudited({ blob, field, subjectType: "Associate", subjectId: associateId, actorUserId: session.user.id });
  if (value == null) return { ok: false, error: t("notFound") };
  return { ok: true, value };
}

// app_role provisioned from org designation (16-Jul: each sales tier has its own role; cf. roleForDesignation in lib/rbac.ts)
const ROLE_FOR_DESIGNATION: Record<Designation, AppRole> = {
  SalesDirector: AppRole.SalesDirector,
  SalesManager: AppRole.SalesManager,
  SalesAssistantManager: AppRole.SalesAssistantManager,
  SalesAssociate: AppRole.SalesAssociate,
};


export type NewAssociateInput = {
  fullName: string;
  businessName?: string;
  mobileNumber?: string;
  email?: string;
  nric?: string;
  dateOfBirth?: string;
  designation: Designation;
  directUplineCode?: string;
  teamName?: string;
  recruitingManager?: string;
  paymentMethod?: "PayNow" | "Bank Transfer";
  paynowNumber?: string;
  bankName?: string;
  bankAccountNumber?: string;
};

async function nextAssociateCode(): Promise<string> {
  const last = await prisma.associate.findFirst({ orderBy: { associateCode: "desc" }, select: { associateCode: true } });
  const n = last ? parseInt(last.associateCode.replace(/\D/g, ""), 10) + 1 : 1;
  return `EN${String(n).padStart(4, "0")}`;
}

// The form renders optional fields as `value={f.x ?? ""}`, so clearing one
// after typing sends "" rather than undefined. newAssociateSchema treats
// these as optional-but-non-empty-when-present (e.g. nric/email), so "" would
// otherwise be wrongly rejected as invalidInput even though the user's intent
// was "leave this blank" — normalize before validating.
const BLANKABLE_KEYS: (keyof NewAssociateInput)[] = [
  "businessName", "mobileNumber", "email", "nric", "dateOfBirth",
  "directUplineCode", "teamName", "recruitingManager", "paymentMethod",
  "paynowNumber", "bankName", "bankAccountNumber",
];
function blankToUndefined(input: NewAssociateInput): NewAssociateInput {
  const out = { ...input };
  for (const k of BLANKABLE_KEYS) {
    if (out[k] === "") delete out[k];
  }
  return out;
}

export async function createAssociate(input: NewAssociateInput): Promise<{ ok: boolean; error?: string; code?: string }> {
  const t = await getTranslations("errors");
  const v = validate(newAssociateSchema, blankToUndefined(input));
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };

  const directUpline = validInput.directUplineCode
    ? await prisma.associate.findUnique({ where: { associateCode: validInput.directUplineCode } })
    : null;
  if (validInput.directUplineCode && !directUpline) return { ok: false, error: t("directUplineNotFound") };

  const code = await nextAssociateCode();
  await prisma.associate.create({
    data: {
      associateCode: code,
      fullName: validInput.fullName.trim(),
      businessName: validInput.businessName?.trim() || null,
      mobileNumber: validInput.mobileNumber?.trim() || null,
      email: validInput.email?.trim() || null,
      nric: validInput.nric ? encryptPII(validInput.nric.trim()) : null,
      dateOfBirth: validInput.dateOfBirth ? new Date(validInput.dateOfBirth) : null,
      designation: validInput.designation,
      directUplineId: directUpline?.id ?? null,
      secondUplineId: directUpline?.directUplineId ?? null, // auto-derive
      recruitingManager: validInput.recruitingManager?.trim() || null,
      teamName: validInput.teamName?.trim() || null,
      paymentMethod: validInput.paymentMethod === "Bank Transfer" ? PaymentMethod.BankTransfer : validInput.paymentMethod === "PayNow" ? PaymentMethod.PayNow : null,
      paynowNumber: validInput.paynowNumber?.trim() || null,
      bankName: validInput.bankName?.trim() || null,
      bankAccountNumber: validInput.bankAccountNumber ? encryptPII(validInput.bankAccountNumber.trim()) : null,
      approvalStatus: ApprovalStatus.Pending,
      associateStatus: AssociateStatus.Inactive,
    },
  });
  revalidatePath("/admin/associates");
  return { ok: true, code };
}

/** Approve/Reject/Incomplete. On Approve → activate + provision a login if none. */
export async function setApprovalStatus(
  id: string,
  status: "Approved" | "Rejected" | "Incomplete",
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };
  const a = await prisma.associate.findUnique({ where: { id }, include: { user: true } });
  if (!a) return { ok: false, error: t("notFound") };

  const approvalStatus = ApprovalStatus[status];
  await prisma.associate.update({
    where: { id },
    data: {
      approvalStatus,
      associateStatus: status === "Approved" ? AssociateStatus.Active : a.associateStatus,
    },
  });

  // provision a login on first approval if the associate has an email and no user
  if (status === "Approved" && !a.user && a.email) {
    const pwHash = await hash(generateTempPassword());
    const user = await prisma.user.create({
      data: { email: a.email, passwordHash: pwHash, role: ROLE_FOR_DESIGNATION[a.designation], associateId: a.id, mustResetPassword: true },
    });
    await prisma.pFile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, associateId: a.id } });
  }

  await logAudit({ action: `associate.approval.${approvalStatus}`, entityType: "Associate", entityId: id, before: { approvalStatus: a.approvalStatus }, after: { approvalStatus } });
  revalidatePath("/admin/associates");
  revalidatePath("/admin/dashboard");
  return { ok: true };
}

export async function setAssociateStatus(
  id: string,
  status: "Active" | "Suspended" | "Terminated" | "Inactive",
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };
  await prisma.associate.update({ where: { id }, data: { associateStatus: AssociateStatus[status] } });
  // reflect login enablement
  const a = await prisma.associate.findUnique({ where: { id }, include: { user: true } });
  if (a?.user) {
    await prisma.user.update({ where: { id: a.user.id }, data: { isActive: status === "Active" } });
  }
  await logAudit({ action: `associate.status.${status}`, entityType: "Associate", entityId: id });
  revalidatePath("/admin/associates");
  return { ok: true };
}
