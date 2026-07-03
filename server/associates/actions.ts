"use server";

import { revalidatePath } from "next/cache";
import { ApprovalStatus, AssociateStatus, Designation, PaymentMethod, AppRole } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { encryptPII } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

// app_role provisioned from org designation (ASM has no dedicated role → Consultant scope)
const ROLE_FOR_DESIGNATION: Record<Designation, AppRole> = {
  SalesDirector: AppRole.SalesDirector,
  SalesManager: AppRole.SalesManager,
  AssistantSalesManager: AppRole.Consultant,
  SalesConsultant: AppRole.Consultant,
};

const TEMP_PASSWORD = "Enshrine#2026"; // temporary login pw on provisioning; user should reset

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

export async function createAssociate(input: NewAssociateInput): Promise<{ ok: boolean; error?: string; code?: string }> {
  const t = await getTranslations("errors");
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };
  if (!input.fullName?.trim()) return { ok: false, error: t("fullNameRequired") };

  const directUpline = input.directUplineCode
    ? await prisma.associate.findUnique({ where: { associateCode: input.directUplineCode } })
    : null;
  if (input.directUplineCode && !directUpline) return { ok: false, error: t("directUplineNotFound") };

  const code = await nextAssociateCode();
  await prisma.associate.create({
    data: {
      associateCode: code,
      fullName: input.fullName.trim(),
      businessName: input.businessName?.trim() || null,
      mobileNumber: input.mobileNumber?.trim() || null,
      email: input.email?.trim() || null,
      nric: input.nric ? encryptPII(input.nric.trim()) : null,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      designation: input.designation,
      directUplineId: directUpline?.id ?? null,
      secondUplineId: directUpline?.directUplineId ?? null, // auto-derive
      recruitingManager: input.recruitingManager?.trim() || null,
      teamName: input.teamName?.trim() || null,
      paymentMethod: input.paymentMethod === "Bank Transfer" ? PaymentMethod.BankTransfer : input.paymentMethod === "PayNow" ? PaymentMethod.PayNow : null,
      paynowNumber: input.paynowNumber?.trim() || null,
      bankName: input.bankName?.trim() || null,
      bankAccountNumber: input.bankAccountNumber ? encryptPII(input.bankAccountNumber.trim()) : null,
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
    const pwHash = await hash(TEMP_PASSWORD);
    const user = await prisma.user.create({
      data: { email: a.email, passwordHash: pwHash, role: ROLE_FOR_DESIGNATION[a.designation], associateId: a.id },
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
