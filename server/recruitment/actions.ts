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
import { isAdminRole, canRecruit } from "@/lib/rbac";
import { encryptPII, maskNric } from "@/lib/crypto";
import { putObject, getObject } from "@/lib/storage";
import { assertUpload } from "@/lib/file-type";
import { humanize } from "@/lib/labels";
import { renderAgreementPdf } from "@/lib/pdf/agreement";
import { sendMail, onboardingInviteEmail, approvalEmail } from "@/lib/mail";
import { logAudit } from "@/lib/audit";
import { generateTempPassword } from "@/lib/temp-password";
import { validate } from "@/lib/validate";
import { onboardingSchema } from "@/lib/schemas";
import { checkRateLimit, recordFailure } from "@/lib/rate-limit";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

// Recruitment invite is open to SAM and above (16-Jul RBAC matrix §A).
async function requireRecruiter() {
  const session = await auth();
  if (!session || !canRecruit(session.user.role)) return null;
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

// app_role provisioned from org designation (16-Jul: each sales tier has its own role; cf. roleForDesignation in lib/rbac.ts)
const ROLE_FOR_DESIGNATION: Record<Designation, AppRole> = {
  SalesDirector: AppRole.SalesDirector,
  SalesManager: AppRole.SalesManager,
  SalesAssistantManager: AppRole.SalesAssistantManager,
  SalesAssociate: AppRole.SalesAssociate,
};


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
  commencementDate?: string;
};

export async function inviteCandidate(input: InviteInput): Promise<{ ok: boolean; error?: string; token?: string; emailed?: boolean }> {
  const t = await getTranslations("errors");
  const session = await requireRecruiter();
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
      commencementDate: input.commencementDate ? new Date(input.commencementDate) : null,
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
/**
 * Cancel a pending invite (Issues v1.0 — Recruitment). Deletes the candidate
 * record, which invalidates the onboarding link already sent (the token is
 * gone). Allowed to the person who sent the invite or a Business Admin, and only
 * while the candidate has not yet been converted into an associate.
 */
export async function cancelInvite(candidateId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session) return { ok: false, error: t("forbidden") };

  const c = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { invitedById: true, convertedAssociateId: true },
  });
  if (!c) return { ok: false, error: t("notFound") };
  if (!(isAdminRole(session.user.role) || c.invitedById === session.user.id)) return { ok: false, error: t("forbidden") };
  if (c.convertedAssociateId) return { ok: false, error: t("alreadyConverted") };

  await prisma.candidate.delete({ where: { id: candidateId } });
  await logAudit({ action: "candidate.invite_cancelled", entityType: "Candidate", entityId: candidateId, actorUserId: session.user.id });
  revalidatePath("/portal/recruitment/new");
  revalidatePath("/admin/recruitment");
  return { ok: true };
}

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
  // V-2026-07 additions.
  maritalStatus?: "Single" | "Married" | "Divorced" | "Widowed";
  spouseConflict?: boolean;
  spouseName?: string;
  spouseCompany?: string;
  spouseDesignation?: string;
  photo?: File | null;
  signature?: string; // PNG data URL from the signature pad
};

// The form renders optional fields as `value={f.x ?? ""}`, so clearing one
// after typing sends "" rather than undefined. onboardingSchema treats
// dateOfBirth/bankAccountNumber as optional-but-non-empty-when-present, so ""
// would otherwise be wrongly rejected as invalidInput (same issue Task 2 hit
// on the associate form) — normalize before validating.
const BLANKABLE_KEYS: (keyof OnboardingSubmission)[] = ["dateOfBirth", "bankAccountNumber"];
function blankToUndefined(input: OnboardingSubmission): OnboardingSubmission {
  const out = { ...input };
  for (const k of BLANKABLE_KEYS) {
    if (out[k] === "") delete out[k];
  }
  return out;
}

export async function submitOnboarding(
  token: string,
  submission: OnboardingSubmission,
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");

  // Rate-limit BEFORE any DB lookup or write, keyed by the onboarding token
  // itself (unguessable, so token-scoped throttling is targeted + safe — no
  // account-enumeration concern the way there would be for an email/IP key).
  if (!(await checkRateLimit(token, "onboard_submit")).allowed) {
    return { ok: false, error: t("tooManyAttempts") };
  }

  const c = await prisma.candidate.findUnique({ where: { onboardingToken: token } });
  if (!c) {
    await recordFailure(token, "onboard_submit");
    return { ok: false, error: t("invalidOrExpiredLink") };
  }
  if (c.onboardingStage === OnboardingStage.Approved) {
    await recordFailure(token, "onboard_submit");
    return { ok: false, error: t("applicationAlreadyApproved") };
  }
  if (c.onboardingStage === OnboardingStage.Rejected) {
    await recordFailure(token, "onboard_submit");
    return { ok: false, error: t("applicationClosed") };
  }

  const v = validate(onboardingSchema, blankToUndefined(submission));
  if (!v.ok) {
    await recordFailure(token, "onboard_submit");
    return { ok: false, error: t("invalidInput") };
  }
  const s = v.data;

  if (!s.nric?.trim()) {
    await recordFailure(token, "onboard_submit");
    return { ok: false, error: t("nricRequired") };
  }
  if (!s.agreementAccepted) {
    await recordFailure(token, "onboard_submit");
    return { ok: false, error: t("agreementRequired") };
  }
  if (!s.signature) {
    await recordFailure(token, "onboard_submit");
    return { ok: false, error: t("signatureRequired") };
  }

  // Optional profile photo → object storage. The browser-supplied MIME type
  // (s.photo.type) is untrustworthy — sniff the real magic bytes instead.
  let photoFileKey = c.photoFileKey ?? undefined;
  if (s.photo && s.photo.size > 0) {
    if (s.photo.size > 5_000_000) {
      await recordFailure(token, "onboard_submit");
      return { ok: false, error: t("photoTooLarge") };
    }
    const photoBytes = new Uint8Array(await s.photo.arrayBuffer());
    let sniffed: "png" | "jpeg";
    try {
      sniffed = assertUpload(photoBytes, ["png", "jpeg"]) as "png" | "jpeg";
    } catch {
      await recordFailure(token, "onboard_submit");
      return { ok: false, error: t("invalidFileType") };
    }
    const ext = sniffed === "jpeg" ? "jpg" : "png";
    photoFileKey = `candidates/${c.id}/photo.${ext}`;
    await putObject(photoFileKey, Buffer.from(photoBytes));
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
    maritalStatus: s.maritalStatus ?? null,
    // Conflict-of-interest declaration (V-2026-07). Spouse details are only kept
    // when the conflict is declared Yes.
    spouseConflict: s.spouseConflict ?? false,
    spouseName: s.spouseConflict ? s.spouseName?.trim() || null : null,
    spouseCompany: s.spouseConflict ? s.spouseCompany?.trim() || null : null,
    spouseDesignation: s.spouseConflict ? s.spouseDesignation?.trim() || null : null,
    agreementAcceptedAt: new Date().toISOString(),
  };

  // E-signature → store the raw signature image, then render and store a signed
  // Associate Agreement PDF embedding it.
  let signedAgreementFileKey = c.signedAgreementFileKey ?? undefined;
  const sigMatch = s.signature.match(/^data:image\/png;base64,(.+)$/);
  if (!sigMatch) {
    await recordFailure(token, "onboard_submit");
    return { ok: false, error: t("signatureInvalid") };
  }
  const signatureBytes = new Uint8Array(Buffer.from(sigMatch[1], "base64"));
  try {
    assertUpload(signatureBytes, ["png"]);
  } catch {
    await recordFailure(token, "onboard_submit");
    return { ok: false, error: t("invalidFileType") };
  }
  await putObject(`candidates/${c.id}/signature.png`, Buffer.from(signatureBytes));

  const upline = c.intendedDirectUplineId
    ? await prisma.associate.findUnique({ where: { id: c.intendedDirectUplineId }, select: { fullName: true, associateCode: true } })
    : null;
  const agreementPdf = await renderAgreementPdf({
    fullName: c.fullName,
    designation: humanize(c.intendedDesignation ?? "Sales Associate"),
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
  // One per-user random temp password: hashed into the login AND emailed to the
  // associate (same value — never diverge, or they can't log in). Forces reset.
  const tempPassword = generateTempPassword();
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
      const pwHash = await hash(tempPassword);
      const user = await tx.user.create({
        data: {
          email: c.email,
          passwordHash: pwHash,
          role: ROLE_FOR_DESIGNATION[c.intendedDesignation!],
          associateId: associate.id,
          mustResetPassword: true,
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
      ...approvalEmail(c.fullName, `${await baseUrl()}/login`, c.email, tempPassword),
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
