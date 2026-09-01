"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { ApprovalStatus, VendorStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { putObject } from "@/lib/storage";
import { assertUpload } from "@/lib/file-type";
import { renderReferralAgreementPdfFromData } from "@/lib/pdf/referral-agreement";

const MAX_BYTES = 15_000_000;

function decodeSignature(dataUrl: string): Uint8Array | null {
  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!m) return null;
  const bytes = new Uint8Array(Buffer.from(m[1], "base64"));
  try {
    assertUpload(bytes, ["png"]);
  } catch {
    return null;
  }
  return bytes;
}

function refreshReferralPaths() {
  revalidatePath("/portal/referrals");
  revalidatePath("/portal/vendors");
  revalidatePath("/admin/vendors");
}

export type VendorInput = {
  vendorName: string;
  vendorType?: string;
  contact?: string;
  remarks?: string;
  agreement?: File | null;
};

/** Submit a vendor referral to the registry (any signed-in associate). */
export async function submitVendor(input: VendorInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user) return { ok: false, error: t("forbidden") };
  if (!input.vendorName?.trim()) return { ok: false, error: t("vendorNameRequired") };

  let agreementFileKey: string | null = null;
  if (input.agreement && input.agreement.size > 0) {
    if (input.agreement.size > MAX_BYTES) return { ok: false, error: t("fileTooLarge") };
    const safeName = input.agreement.name.replace(/[^\w.\-]/g, "_").slice(-80) || "agreement";
    agreementFileKey = `vendors/${randomUUID()}/${safeName}`;
    await putObject(agreementFileKey, Buffer.from(await input.agreement.arrayBuffer()));
  }

  const vendor = await prisma.vendorReferral.create({
    data: {
      vendorName: input.vendorName.trim(),
      vendorType: input.vendorType?.trim() || null,
      contact: input.contact?.trim() || null,
      remarks: input.remarks?.trim() || null,
      agreementFileKey,
      submittedByAssociateId: session.user.associateId ?? null,
      status: VendorStatus.Active,
      approvalStatus: ApprovalStatus.Pending,
    },
  });
  await logAudit({ action: "vendor.submitted", entityType: "VendorReferral", entityId: vendor.id });
  refreshReferralPaths();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Referral partnership submission with the in-person e-form agreement
// (consolidated menu, Sep 2026). The associate fills the Referral & Marketing
// Partnership Agreement on their device, the vendor signs on the spot, and the
// submission lands Pending for Business Admin approval. Everyone can see every
// submission (dedupe) — approval is the admin's call.
// ---------------------------------------------------------------------------
export type ReferralSubmissionInput = {
  vendorName: string;
  vendorType?: string;
  contact?: string;
  remarks?: string;
  vendorUen?: string;
  vendorAddress?: string;
  vendorSignerName: string;
  vendorSignerNric?: string;
  vendorSignerDesignation?: string;
  signatureDataUrl: string; // vendor's on-device signature (PNG data URL)
};

export async function submitReferralPartnership(
  input: ReferralSubmissionInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user) return { ok: false, error: t("forbidden") };
  if (!input.vendorName?.trim()) return { ok: false, error: t("vendorNameRequired") };
  if (!input.vendorSignerName?.trim()) return { ok: false, error: t("allFieldsRequired") };

  const signatureBytes = decodeSignature(input.signatureDataUrl);
  if (!signatureBytes) return { ok: false, error: t("signatureInvalid") };

  const now = new Date();
  const id = randomUUID();
  const signatureKey = `vendors/${id}/vendor-signature.png`;
  await putObject(signatureKey, Buffer.from(signatureBytes));

  // Vendor-signed agreement PDF, rendered at submission (the Company
  // countersigns at approval, which re-renders the final document).
  const pdf = await renderReferralAgreementPdfFromData({
    agreementDate: now,
    vendorName: input.vendorName.trim(),
    vendorUen: input.vendorUen?.trim() || null,
    vendorAddress: input.vendorAddress?.trim() || null,
    vendorSignerName: input.vendorSignerName.trim(),
    vendorSignerNric: input.vendorSignerNric?.trim() || null,
    vendorSignerDesignation: input.vendorSignerDesignation?.trim() || null,
    vendorSignatureDataUrl: input.signatureDataUrl,
    vendorSignedDate: now,
    companySignName: null,
    companySignDesignation: null,
    companySignatureDataUrl: null,
    companySignedAt: null,
  });
  const pdfKey = `vendors/${id}/agreement.pdf`;
  await putObject(pdfKey, pdf);

  const vendor = await prisma.vendorReferral.create({
    data: {
      id,
      vendorName: input.vendorName.trim(),
      vendorType: input.vendorType?.trim() || null,
      contact: input.contact?.trim() || null,
      remarks: input.remarks?.trim() || null,
      submittedByAssociateId: session.user.associateId ?? null,
      status: VendorStatus.Active,
      approvalStatus: ApprovalStatus.Pending,
      agreementDate: now,
      vendorUen: input.vendorUen?.trim() || null,
      vendorAddress: input.vendorAddress?.trim() || null,
      vendorSignerName: input.vendorSignerName.trim(),
      vendorSignerNric: input.vendorSignerNric?.trim() || null,
      vendorSignerDesignation: input.vendorSignerDesignation?.trim() || null,
      vendorSignatureKey: signatureKey,
      agreementPdfKey: pdfKey,
    },
  });
  await logAudit({ action: "referral.submitted", entityType: "VendorReferral", entityId: vendor.id });
  refreshReferralPaths();
  return { ok: true, id: vendor.id };
}

/** Approve a referral partnership (Business Admin), countersigning the
 *  agreement on behalf of the Company and re-rendering the final PDF. */
export async function approveReferral(
  id: string,
  input: { companySignName: string; companySignDesignation?: string; signatureDataUrl?: string },
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };
  if (!input.companySignName?.trim()) return { ok: false, error: t("allFieldsRequired") };

  const v = await prisma.vendorReferral.findUnique({ where: { id } });
  if (!v) return { ok: false, error: t("notFound") };
  if (v.approvalStatus === ApprovalStatus.Approved) return { ok: false, error: t("alreadyProcessed") };

  let companySignatureKey: string | null = null;
  if (input.signatureDataUrl) {
    const bytes = decodeSignature(input.signatureDataUrl);
    if (!bytes) return { ok: false, error: t("signatureInvalid") };
    companySignatureKey = `vendors/${id}/company-signature.png`;
    await putObject(companySignatureKey, Buffer.from(bytes));
  }

  const now = new Date();
  await prisma.vendorReferral.update({
    where: { id },
    data: {
      approvalStatus: ApprovalStatus.Approved,
      reviewedById: session.user.id,
      reviewedAt: now,
      rejectReason: null,
      companySignName: input.companySignName.trim(),
      companySignDesignation: input.companySignDesignation?.trim() || null,
      companySignatureKey,
      companySignedAt: now,
      companySignedById: session.user.id,
    },
  });

  // Final agreement with both signatures — only when the e-form flow was used
  // (legacy uploaded-file referrals keep their uploaded agreement).
  if (v.vendorSignatureKey || v.agreementPdfKey) {
    const { renderReferralAgreementPdf } = await import("@/lib/pdf/referral-agreement");
    const pdf = await renderReferralAgreementPdf(id);
    if (pdf) {
      const pdfKey = v.agreementPdfKey ?? `vendors/${id}/agreement.pdf`;
      await putObject(pdfKey, pdf.buffer);
      if (!v.agreementPdfKey) {
        await prisma.vendorReferral.update({ where: { id }, data: { agreementPdfKey: pdfKey } });
      }
    }
  }

  await logAudit({ action: "referral.approved", entityType: "VendorReferral", entityId: id, actorUserId: session.user.id });
  refreshReferralPaths();
  return { ok: true };
}

/** Reject a referral partnership (Business Admin). The row stays visible to
 *  everyone — a rejected vendor shows as rejected, keeping the dedupe value. */
export async function rejectReferral(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };

  const v = await prisma.vendorReferral.findUnique({ where: { id }, select: { approvalStatus: true } });
  if (!v) return { ok: false, error: t("notFound") };

  await prisma.vendorReferral.update({
    where: { id },
    data: {
      approvalStatus: ApprovalStatus.Rejected,
      reviewedById: session.user.id,
      reviewedAt: new Date(),
      rejectReason: reason?.trim() || null,
    },
  });
  await logAudit({ action: "referral.rejected", entityType: "VendorReferral", entityId: id, actorUserId: session.user.id });
  refreshReferralPaths();
  return { ok: true };
}

export async function setVendorStatus(id: string, status: "Active" | "Lapsed"): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };
  await prisma.vendorReferral.update({ where: { id }, data: { status: VendorStatus[status] } });
  await logAudit({ action: `vendor.status_${status.toLowerCase()}`, entityType: "VendorReferral", entityId: id, actorUserId: session.user.id });
  refreshReferralPaths();
  return { ok: true };
}
