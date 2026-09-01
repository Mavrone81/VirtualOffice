"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { AshesAgreementStatus, SubmissionStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { putObject } from "@/lib/storage";
import { assertUpload } from "@/lib/file-type";
import { amountToWords } from "@/lib/amount-words";
import { renderAshesAgreementPdf } from "@/lib/pdf/ashes-agreement";
import type { AshesPet } from "@/lib/pdf/ashes-agreement";

// ---------------------------------------------------------------------------
// Storage of Pets Ashes Agreement (consolidated menu, Sep 2026). Pipeline:
// the sale's quotation is approved+signed → the associate fills the
// application-details form (auto-prefilled from the submission) → the client
// signs in person → the rendered PDF joins the sale's docket.
// ---------------------------------------------------------------------------

export type AshesAgreementInput = {
  storageSpaceLocation?: string;
  nicheUnit?: string;
  pets: AshesPet[];
  applicant1Name: string;
  applicant1Nric?: string;
  applicant1Address?: string;
  applicant1Contact?: string;
  applicant1Email?: string;
  applicant2Name?: string;
  applicant2Nric?: string;
  applicant2Address?: string;
  applicant2Contact?: string;
  applicant2Email?: string;
  instalmentDayOfMonth?: number;
  maintenanceStartYear?: number;
  additionalTerms?: string;
  applicantWitnessName?: string;
  applicantWitnessNric?: string;
  companyWitnessName?: string;
  companyWitnessNric?: string;
};

async function allowedSubmission(submissionId: string) {
  const session = await auth();
  if (!session?.user) return { session: null, sub: null };
  const sub = await prisma.salesSubmission.findUnique({
    where: { id: submissionId },
    include: { ashesAgreement: true },
  });
  if (!sub) return { session, sub: null };
  const allowed =
    isAdminRole(session.user.role) ||
    (!!session.user.associateId && session.user.associateId === sub.closingAssociateId);
  return { session, sub: allowed ? sub : null };
}

/** Create/update the application details (Draft). Amounts and the payment plan
 *  auto-fill from the submission — the agreement mirrors the sale. */
export async function saveAshesAgreement(
  submissionId: string,
  input: AshesAgreementInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const t = await getTranslations("errors");
  const { session, sub } = await allowedSubmission(submissionId);
  if (!session || !sub) return { ok: false, error: t("forbidden") };
  if (sub.status !== SubmissionStatus.QuotationApproved) return { ok: false, error: t("quotationNotApproved") };
  if (sub.ashesAgreement?.status === AshesAgreementStatus.Signed) return { ok: false, error: t("alreadyProcessed") };
  if (!input.applicant1Name?.trim()) return { ok: false, error: t("allFieldsRequired") };

  const pets = (input.pets ?? [])
    .map((p) => ({
      name: p.name?.trim() || undefined,
      breed: p.breed?.trim() || undefined,
      gender: p.gender?.trim() || undefined,
      dob: p.dob?.trim() || undefined,
      dateDismissed: p.dateDismissed?.trim() || undefined,
    }))
    .filter((p) => Object.values(p).some(Boolean))
    .slice(0, 10);

  const isInstalment = sub.paymentPlan === "Installment";
  const monthly =
    isInstalment && sub.installmentCount
      ? sub.saleAmount.minus(sub.deposit ?? 0).div(sub.installmentCount)
      : null;

  const data = {
    storageSpaceLocation: input.storageSpaceLocation?.trim() || null,
    nicheUnit: input.nicheUnit?.trim() || null,
    pets,
    applicant1Name: input.applicant1Name.trim(),
    applicant1Nric: input.applicant1Nric?.trim() || null,
    applicant1Address: input.applicant1Address?.trim() || null,
    applicant1Contact: input.applicant1Contact?.trim() || null,
    applicant1Email: input.applicant1Email?.trim() || null,
    applicant2Name: input.applicant2Name?.trim() || null,
    applicant2Nric: input.applicant2Nric?.trim() || null,
    applicant2Address: input.applicant2Address?.trim() || null,
    applicant2Contact: input.applicant2Contact?.trim() || null,
    applicant2Email: input.applicant2Email?.trim() || null,
    // Auto-pushed from the submission (the user's pipeline requirement).
    amountNumeric: sub.saleAmount,
    amountWords: amountToWords(sub.saleAmount.toString()),
    paymentPlan: sub.paymentPlan,
    bookingFee: isInstalment ? sub.deposit : null,
    monthlyInstalment: monthly,
    instalmentDayOfMonth: isInstalment ? (input.instalmentDayOfMonth ?? null) : null,
    maintenanceStartYear: input.maintenanceStartYear ?? new Date().getFullYear() + 1,
    additionalTerms: input.additionalTerms?.trim() || null,
    applicantWitnessName: input.applicantWitnessName?.trim() || null,
    applicantWitnessNric: input.applicantWitnessNric?.trim() || null,
    companyWitnessName: input.companyWitnessName?.trim() || null,
    companyWitnessNric: input.companyWitnessNric?.trim() || null,
  };

  const agreement = sub.ashesAgreement
    ? await prisma.petsAshesAgreement.update({ where: { id: sub.ashesAgreement.id }, data })
    : await prisma.petsAshesAgreement.create({
        data: { ...data, submissionId, createdById: session.user.id },
      });

  await logAudit({
    action: sub.ashesAgreement ? "ashes_agreement.updated" : "ashes_agreement.created",
    entityType: "PetsAshesAgreement",
    entityId: agreement.id,
    actorUserId: session.user.id,
  });
  revalidatePath("/portal/agreements");
  revalidatePath(`/portal/sales/${submissionId}/agreement`);
  return { ok: true, id: agreement.id };
}

/** In-person applicant signature: validates the PNG, marks the agreement
 *  Signed, renders the final PDF and files it into the sale's docket. */
export async function signAshesAgreement(
  submissionId: string,
  signatureDataUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const { session, sub } = await allowedSubmission(submissionId);
  if (!session || !sub) return { ok: false, error: t("forbidden") };
  const agreement = sub.ashesAgreement;
  if (!agreement) return { ok: false, error: t("notFound") };
  if (agreement.status === AshesAgreementStatus.Signed) return { ok: false, error: t("alreadyProcessed") };

  const m = signatureDataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!m) return { ok: false, error: t("signatureInvalid") };
  const bytes = new Uint8Array(Buffer.from(m[1], "base64"));
  try {
    assertUpload(bytes, ["png"]);
  } catch {
    return { ok: false, error: t("signatureInvalid") };
  }

  const signatureKey = `submissions/${submissionId}/ashes-signature.png`;
  await putObject(signatureKey, Buffer.from(bytes));

  await prisma.petsAshesAgreement.update({
    where: { id: agreement.id },
    data: { status: AshesAgreementStatus.Signed, signedAt: new Date(), applicantSignatureKey: signatureKey },
  });

  const pdf = await renderAshesAgreementPdf(agreement.id);
  if (!pdf) return { ok: false, error: t("notFound") };
  const pdfKey = `submissions/${submissionId}/${randomUUID()}.pdf`;
  await putObject(pdfKey, pdf.buffer);
  await prisma.petsAshesAgreement.update({ where: { id: agreement.id }, data: { agreementPdfKey: pdfKey } });
  await prisma.submissionDocument.create({
    data: { submissionId, kind: "Signed", fileKey: pdfKey, fileName: pdf.filename, uploadedById: session.user.id },
  });

  await logAudit({
    action: "ashes_agreement.signed",
    entityType: "PetsAshesAgreement",
    entityId: agreement.id,
    actorUserId: session.user.id,
  });
  revalidatePath("/portal/agreements");
  revalidatePath("/portal/quotations");
  revalidatePath(`/portal/sales/${submissionId}/agreement`);
  return { ok: true };
}
