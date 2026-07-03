"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  ApprovalStatus, AssociateStatus, Designation, OnboardingStage,
  PaymentMethod, AppRole, PFileDocType,
} from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { isAdminRole } from "@/lib/rbac";
import { encryptPII, maskNric } from "@/lib/crypto";
import { putObject, getObject, imageExt } from "@/lib/storage";
import { humanize } from "@/lib/labels";
import { renderAgreementPdf } from "@/lib/pdf/agreement";
import { sendMail, onboardingInviteEmail, approvalEmail } from "@/lib/mail";
import { logAudit } from "@/lib/audit";

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
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  if (!input.fullName?.trim()) return { ok: false, error: t("fullNameRequired") };
  if (!input.email?.trim()) return { ok: false, error: t("emailRequired") };

  const upline = input.intendedDirectUplineCode
    ? await prisma.associate.findUnique({ where: { associateCode: input.intendedDirectUplineCode } })
    : null;
  if (input.intendedDirectUplineCode && !upline) return { ok: false, error: t("uplineCodeNotFound") };

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
  photo?: File | null;
  signature?: string; // PNG data URL from the signature pad
};

export async function submitOnboarding(
  token: string,
  s: OnboardingSubmission,
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const c = await prisma.candidate.findUnique({ where: { onboardingToken: token } });
  if (!c) return { ok: false, error: t("invalidOrExpiredLink") };
  if (c.onboardingStage === OnboardingStage.Approved) return { ok: false, error: t("applicationAlreadyApproved") };
  if (c.onboardingStage === OnboardingStage.Rejected) return { ok: false, error: t("applicationClosed") };
  if (!s.nric?.trim()) return { ok: false, error: t("nricRequired") };
  if (!s.agreementAccepted) return { ok: false, error: t("agreementRequired") };
  if (!s.signature) return { ok: false, error: t("signatureRequired") };

  // Optional profile photo → object storage.
  let photoFileKey = c.photoFileKey ?? undefined;
  if (s.photo && s.photo.size > 0) {
    const ext = imageExt(s.photo.type);
    if (!ext) return { ok: false, error: t("photoInvalidFormat") };
    if (s.photo.size > 5_000_000) return { ok: false, error: t("photoTooLarge") };
    photoFileKey = `candidates/${c.id}/photo.${ext}`;
    await putObject(photoFileKey, Buffer.from(await s.photo.arrayBuffer()));
  }

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

  // E-signature → store the raw signature image, then render and store a signed
  // Associate Agreement PDF embedding it.
  let signedAgreementFileKey = c.signedAgreementFileKey ?? undefined;
  const sigMatch = s.signature.match(/^data:image\/png;base64,(.+)$/);
  if (!sigMatch) return { ok: false, error: t("signatureInvalid") };
  await putObject(`candidates/${c.id}/signature.png`, Buffer.from(sigMatch[1], "base64"));

  const upline = c.intendedDirectUplineId
    ? await prisma.associate.findUnique({ where: { id: c.intendedDirectUplineId }, select: { fullName: true, associateCode: true } })
    : null;
  const agreementPdf = await renderAgreementPdf({
    fullName: c.fullName,
    designation: humanize(c.intendedDesignation ?? "Sales Consultant"),
    email: c.email,
    mobile: c.mobileNumber,
    nricMasked: maskNric(s.nric.trim()),
    teamName: c.intendedTeam,
    uplineName: upline ? `${upline.fullName} (${upline.associateCode})` : null,
    signedDate: new Date(),
    signatureDataUrl: s.signature,
  });
  signedAgreementFileKey = `candidates/${c.id}/signed-agreement.pdf`;
  await putObject(signedAgreementFileKey, agreementPdf);

  await prisma.candidate.update({
    where: { id: c.id },
    data: {
      submittedPayload: payload,
      photoFileKey,
      signedAgreementFileKey,
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
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const c = await prisma.candidate.findUnique({ where: { id } });
  if (!c) return { ok: false, error: t("notFound") };
  if (c.convertedAssociateId) return { ok: false, error: t("alreadyConverted") };
  if (c.onboardingStage !== OnboardingStage.SignedPendingApproval && c.onboardingStage !== OnboardingStage.FormSubmitted)
    return { ok: false, error: t("onboardingIncomplete") };
  if (!c.intendedDesignation) return { ok: false, error: t("noDesignationSet") };

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

    // Copy onboarding artifacts (photo, signed agreement) into the associate's
    // own namespace so they're viewable in the portal (serving route scopes
    // non-admins to associates/<id>/).
    if (c.photoFileKey) {
      const buf = await getObject(c.photoFileKey);
      if (buf) {
        const ext = c.photoFileKey.split(".").pop() ?? "jpg";
        const key = `associates/${associate.id}/photo.${ext}`;
        await putObject(key, buf);
        await tx.associate.update({ where: { id: associate.id }, data: { photoFileKey: key } });
      }
    }
    let associateAgreementKey: string | null = null;
    if (c.signedAgreementFileKey) {
      const buf = await getObject(c.signedAgreementFileKey);
      if (buf) {
        associateAgreementKey = `associates/${associate.id}/signed-agreement.pdf`;
        await putObject(associateAgreementKey, buf);
        await tx.associate.update({ where: { id: associate.id }, data: { signedAgreementFileKey: associateAgreementKey } });
      }
    }

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
      if (associateAgreementKey) {
        await tx.pFileDocument.create({
          data: {
            pFileId: pFile.id,
            docType: PFileDocType.SignedAssociateAgreement,
            title: "Signed Associate Agreement",
            fileKey: associateAgreementKey,
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

  await logAudit({ action: "candidate.approved", entityType: "Candidate", entityId: c.id, after: { associateCode: result.code } });
  revalidatePath("/admin/recruitment");
  revalidatePath("/admin/associates");
  revalidatePath("/admin/dashboard");
  return { ok: true, code: result.code };
}

export async function rejectCandidate(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  const c = await prisma.candidate.findUnique({ where: { id } });
  if (!c) return { ok: false, error: t("notFound") };
  await prisma.candidate.update({
    where: { id },
    data: {
      onboardingStage: OnboardingStage.Rejected,
      rejectReason: reason?.trim() || null,
      reviewedById: session.user.id,
    },
  });
  await logAudit({ action: "candidate.rejected", entityType: "Candidate", entityId: id, actorUserId: session.user.id, after: { reason: reason?.trim() || null } });
  revalidatePath("/admin/recruitment");
  revalidatePath(`/admin/recruitment/${id}`);
  return { ok: true };
}
