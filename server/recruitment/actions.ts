"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  ApprovalStatus, AssociateStatus, Designation, OnboardingStage,
  PaymentMethod, AppRole, PFileDocType,
} from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isAdminRole } from "@/lib/rbac";
import { encryptPII } from "@/lib/crypto";
import { sendMail, onboardingInviteEmail, approvalEmail } from "@/lib/mail";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

// Absolute base URL for links in emails: prefer AUTH_URL, else the request host.
async function baseUrl(): Promise<string> {
  if (env.AUTH_URL) return env.AUTH_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

// app_role provisioned from org designation (ASM has no dedicated role → Consultant scope)
const ROLE_FOR_DESIGNATION: Record<Designation, AppRole> = {
  SalesDirector: AppRole.SalesDirector,
  SalesManager: AppRole.SalesManager,
  AssistantSalesManager: AppRole.Consultant,
  SalesConsultant: AppRole.Consultant,
};

const TEMP_PASSWORD = "Enshrine#2026"; // temporary login pw on provisioning; user should reset

async function nextAssociateCode(): Promise<string> {
  const last = await prisma.associate.findFirst({ orderBy: { associateCode: "desc" }, select: { associateCode: true } });
  const n = last ? parseInt(last.associateCode.replace(/\D/g, ""), 10) + 1 : 1;
  return `EN${String(n).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Invite (admin) — creates a candidate + unique onboarding link
// ---------------------------------------------------------------------------
export type InviteInput = {
  fullName: string;
  mobileNumber: string;
  email: string;
  intendedDesignation: Designation;
  intendedDirectUplineCode?: string;
  intendedTeam?: string;
};

export async function inviteCandidate(input: InviteInput): Promise<{ ok: boolean; error?: string; token?: string; emailed?: boolean }> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Forbidden" };
  if (!input.fullName?.trim()) return { ok: false, error: "Full name is required." };
  if (!input.email?.trim()) return { ok: false, error: "Email is required." };

  const upline = input.intendedDirectUplineCode
    ? await prisma.associate.findUnique({ where: { associateCode: input.intendedDirectUplineCode } })
    : null;
  if (input.intendedDirectUplineCode && !upline) return { ok: false, error: "Upline code not found." };

  const token = randomBytes(24).toString("base64url");
  const email = input.email.trim().toLowerCase();
  const candidate = await prisma.candidate.create({
    data: {
      fullName: input.fullName.trim(),
      mobileNumber: input.mobileNumber.trim(),
      email,
      intendedDesignation: input.intendedDesignation,
      intendedDirectUplineId: upline?.id ?? null,
      intendedTeam: input.intendedTeam?.trim() || null,
      onboardingToken: token,
      onboardingStage: OnboardingStage.Invited,
      invitedById: session.user.id,
    },
  });

  // Best-effort email of the onboarding link (no-op if SMTP unconfigured).
  const link = `${await baseUrl()}/onboard/${token}`;
  const { sent } = await sendMail({ ...onboardingInviteEmail(candidate.fullName, link), to: email });

  revalidatePath("/admin/recruitment");
  return { ok: true, token, emailed: sent };
}

// ---------------------------------------------------------------------------
// Candidate self-onboarding (PUBLIC — no session, gated by unguessable token)
// ---------------------------------------------------------------------------
export type OnboardingSubmission = {
  businessName?: string;
  nric: string;
  dateOfBirth?: string;
  residentialAddress?: string;
  emergencyContactName?: string;
  emergencyContactNumber?: string;
  paymentMethod: "PayNow" | "Bank Transfer";
  paynowNumber?: string;
  bankName?: string;
  bankAccountNumber?: string;
  agreementAccepted: boolean;
};

export async function submitOnboarding(
  token: string,
  s: OnboardingSubmission,
): Promise<{ ok: boolean; error?: string }> {
  const c = await prisma.candidate.findUnique({ where: { onboardingToken: token } });
  if (!c) return { ok: false, error: "Invalid or expired link." };
  if (c.onboardingStage === OnboardingStage.Approved) return { ok: false, error: "Your application is already approved." };
  if (c.onboardingStage === OnboardingStage.Rejected) return { ok: false, error: "This application is closed." };
  if (!s.nric?.trim()) return { ok: false, error: "NRIC/FIN is required." };
  if (!s.agreementAccepted) return { ok: false, error: "You must accept the Associate Agreement to continue." };

  // Sensitive fields are encrypted at rest inside the JSON payload; the same
  // ciphertext is copied verbatim onto the Associate record on approval.
  const payload = {
    businessName: s.businessName?.trim() || null,
    nric: encryptPII(s.nric.trim()),
    dateOfBirth: s.dateOfBirth || null,
    residentialAddress: s.residentialAddress?.trim() || null,
    emergencyContactName: s.emergencyContactName?.trim() || null,
    emergencyContactNumber: s.emergencyContactNumber?.trim() || null,
    paymentMethod: s.paymentMethod,
    paynowNumber: s.paynowNumber?.trim() || null,
    bankName: s.bankName?.trim() || null,
    bankAccountNumber: s.bankAccountNumber ? encryptPII(s.bankAccountNumber.trim()) : null,
    agreementAcceptedAt: new Date().toISOString(),
  };

  await prisma.candidate.update({
    where: { id: c.id },
    data: {
      submittedPayload: payload,
      onboardingStage: OnboardingStage.SignedPendingApproval,
    },
  });
  revalidatePath("/admin/recruitment");
  revalidatePath(`/admin/recruitment/${c.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Approve (admin) — convert candidate → associate + provision login + P-file
// ---------------------------------------------------------------------------
type StoredPayload = {
  businessName?: string | null;
  nric?: string | null; // already encrypted
  dateOfBirth?: string | null;
  paymentMethod?: "PayNow" | "Bank Transfer" | null;
  paynowNumber?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null; // already encrypted
};

export async function approveCandidate(id: string): Promise<{ ok: boolean; error?: string; code?: string }> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Forbidden" };

  const c = await prisma.candidate.findUnique({ where: { id } });
  if (!c) return { ok: false, error: "Not found" };
  if (c.convertedAssociateId) return { ok: false, error: "Already converted." };
  if (c.onboardingStage !== OnboardingStage.SignedPendingApproval && c.onboardingStage !== OnboardingStage.FormSubmitted)
    return { ok: false, error: "Candidate has not completed onboarding yet." };
  if (!c.intendedDesignation) return { ok: false, error: "No intended designation set." };

  const p = (c.submittedPayload as StoredPayload | null) ?? {};
  const upline = c.intendedDirectUplineId
    ? await prisma.associate.findUnique({ where: { id: c.intendedDirectUplineId } })
    : null;

  const code = await nextAssociateCode();
  const pm = p.paymentMethod === "Bank Transfer" ? PaymentMethod.BankTransfer
    : p.paymentMethod === "PayNow" ? PaymentMethod.PayNow : null;

  const result = await prisma.$transaction(async (tx) => {
    let provisioned = false;
    const associate = await tx.associate.create({
      data: {
        associateCode: code,
        fullName: c.fullName,
        businessName: p.businessName ?? null,
        mobileNumber: c.mobileNumber,
        email: c.email,
        nric: p.nric ?? null, // already ciphertext
        dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
        designation: c.intendedDesignation!,
        directUplineId: upline?.id ?? null,
        secondUplineId: upline?.directUplineId ?? null,
        teamName: c.intendedTeam,
        paymentMethod: pm,
        paynowNumber: p.paynowNumber ?? null,
        bankName: p.bankName ?? null,
        bankAccountNumber: p.bankAccountNumber ?? null, // already ciphertext
        joinDate: new Date(),
        approvalStatus: ApprovalStatus.Approved,
        associateStatus: AssociateStatus.Active,
      },
    });

    // provision a login if the candidate email is not already taken
    const existing = await tx.user.findUnique({ where: { email: c.email } });
    if (!existing) {
      provisioned = true;
      const pwHash = await hash(TEMP_PASSWORD);
      const user = await tx.user.create({
        data: {
          email: c.email,
          passwordHash: pwHash,
          role: ROLE_FOR_DESIGNATION[c.intendedDesignation!],
          associateId: associate.id,
        },
      });
      const pFile = await tx.pFile.create({ data: { userId: user.id, associateId: associate.id } });
      if (c.signedAgreementFileKey) {
        await tx.pFileDocument.create({
          data: {
            pFileId: pFile.id,
            docType: PFileDocType.SignedAssociateAgreement,
            title: "Signed Associate Agreement",
            fileKey: c.signedAgreementFileKey,
            filedById: session.user.id,
            filedAt: new Date(),
          },
        });
      }
    }

    await tx.candidate.update({
      where: { id: c.id },
      data: {
        onboardingStage: OnboardingStage.Approved,
        reviewedById: session.user.id,
        convertedAssociateId: associate.id,
      },
    });
    return { code: associate.associateCode, provisioned };
  });

  // Email the new associate their login credentials (best-effort, post-commit).
  if (result.provisioned) {
    await sendMail({
      ...approvalEmail(c.fullName, `${await baseUrl()}/login`, c.email, TEMP_PASSWORD),
      to: c.email,
    });
  }

  revalidatePath("/admin/recruitment");
  revalidatePath("/admin/associates");
  revalidatePath("/admin/dashboard");
  return { ok: true, code: result.code };
}

export async function rejectCandidate(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Forbidden" };
  const c = await prisma.candidate.findUnique({ where: { id } });
  if (!c) return { ok: false, error: "Not found" };
  await prisma.candidate.update({
    where: { id },
    data: {
      onboardingStage: OnboardingStage.Rejected,
      rejectReason: reason?.trim() || null,
      reviewedById: session.user.id,
    },
  });
  revalidatePath("/admin/recruitment");
  revalidatePath(`/admin/recruitment/${id}`);
  return { ok: true };
}
