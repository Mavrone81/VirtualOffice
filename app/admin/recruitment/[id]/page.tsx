import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { OnboardingStage } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { auth } from "@/auth";
import { maskNric, maskAccount } from "@/lib/crypto";
import { decryptPiiAudited } from "@/server/pii";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { ReviewActions } from "./review-actions";

export const metadata = { title: "Candidate · Enshrine Admin" };

type StoredPayload = {
  businessName?: string | null;
  nric?: string | null;
  dateOfBirth?: string | null;
  residentialAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactNumber?: string | null;
  paymentMethod?: string | null;
  paynowNumber?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  agreementAcceptedAt?: string | null;
};

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-2">{label}</div>
      <div className="mt-0.5 text-[13px] text-ink">{value || "—"}</div>
    </div>
  );
}

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("recruitment");
  const session = await auth();
  const { id } = await params;
  const c = await prisma.candidate.findUnique({
    where: { id },
    include: {
      intendedDirectUpline: { select: { associateCode: true, fullName: true } },
      invitedBy: { select: { email: true } },
      convertedAssociate: { select: { associateCode: true } },
    },
  });
  if (!c) notFound();

  const p = (c.submittedPayload as StoredPayload | null) ?? {};
  const actorUserId = session?.user.id ?? null;
  const nricPlain = await decryptPiiAudited({ blob: p.nric, field: "nric", subjectType: "Candidate", subjectId: c.id, actorUserId });
  const bankAcctPlain = await decryptPiiAudited({ blob: p.bankAccountNumber, field: "bankAccount", subjectType: "Candidate", subjectId: c.id, actorUserId });
  const submitted = c.onboardingStage !== OnboardingStage.Invited;
  const reviewable =
    c.onboardingStage === OnboardingStage.SignedPendingApproval || c.onboardingStage === OnboardingStage.FormSubmitted;

  return (
    <>
      <PageHeader
        title={c.fullName}
        subtitle={t("detail.headerSubtitle", { designation: humanize(c.intendedDesignation ?? ""), date: format(c.createdAt, "dd MMM yyyy") })}
      >
        <StatusPill status={c.onboardingStage} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 font-display text-[16px] text-ink">{t("detail.intendedPlacement")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("detail.email")} value={c.email} />
              <Field label={t("detail.mobile")} value={c.mobileNumber} />
              <Field label={t("detail.designation")} value={humanize(c.intendedDesignation ?? "")} />
              <Field label={t("detail.directUpline")} value={c.intendedDirectUpline ? `${c.intendedDirectUpline.associateCode} · ${c.intendedDirectUpline.fullName}` : null} />
              <Field label={t("detail.team")} value={c.intendedTeam} />
              <Field label={t("detail.invitedBy")} value={c.invitedBy?.email} />
            </div>
          </Card>

          {submitted ? (
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-4">
                {c.photoFileKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${c.photoFileKey}`} alt={c.fullName} className="h-16 w-16 rounded-full object-cover" />
                ) : null}
                <h2 className="font-display text-[16px] text-ink">{t("detail.submittedDetails")}</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("detail.businessName")} value={p.businessName} />
                <Field label={t("detail.nric")} value={maskNric(nricPlain)} />
                <Field label={t("detail.dob")} value={p.dateOfBirth ? format(new Date(p.dateOfBirth), "dd MMM yyyy") : null} />
                <Field label={t("detail.residentialAddress")} value={p.residentialAddress} />
                <Field label={t("detail.emergencyContact")} value={p.emergencyContactName ? `${p.emergencyContactName} · ${p.emergencyContactNumber ?? ""}` : null} />
                <Field label={t("detail.paymentMethod")} value={p.paymentMethod} />
                {p.paymentMethod === "PayNow"
                  ? <Field label={t("detail.paynow")} value={p.paynowNumber} />
                  : <Field label={t("detail.bankAccount")} value={p.bankName ? `${p.bankName} · ${maskAccount(bankAcctPlain)}` : null} />}
                <Field label={t("detail.agreementSigned")} value={p.agreementAcceptedAt ? format(new Date(p.agreementAcceptedAt), "dd MMM yyyy, HH:mm") : null} />
              </div>
              {c.signedAgreementFileKey && (
                <a
                  href={`/api/files/${c.signedAgreementFileKey}`}
                  target="_blank"
                  rel="noopener"
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line bg-paper-100 px-3 py-2 text-[13px] text-action hover:bg-paper-200"
                >
                  {t("detail.viewAgreement")}
                </a>
              )}
            </Card>
          ) : (
            <Card className="p-5 text-[13px] text-muted">
              {t("detail.pendingSubmission")}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {reviewable && (
            <Card className="p-5">
              <h2 className="mb-3 font-display text-[16px] text-ink">{t("detail.reviewSection")}</h2>
              <p className="mb-4 text-[12px] text-muted">
                {t("detail.reviewDesc")}
              </p>
              <ReviewActions id={c.id} />
            </Card>
          )}

          {c.onboardingStage === OnboardingStage.Approved && c.convertedAssociate && (
            <Card className="p-5">
              <div className="text-[13px] text-success">{t("detail.convertedToAssociate")}</div>
              <Button asChild variant="secondary" className="mt-3 w-full">
                <Link href="/admin/associates">{t("detail.viewAssociate", { code: c.convertedAssociate.associateCode })}</Link>
              </Button>
            </Card>
          )}

          {c.onboardingStage === OnboardingStage.Rejected && (
            <Card className="p-5">
              <div className="text-[13px] font-medium text-danger">{t("detail.rejectedTitle")}</div>
              {c.rejectReason && <p className="mt-2 text-[12px] text-muted">{c.rejectReason}</p>}
            </Card>
          )}

          <Card className="p-5">
            <div className="text-[11px] uppercase tracking-wide text-muted-2">{t("detail.onboardingLink")}</div>
            <p className="mt-2 break-all font-mono text-[11px] text-body">/onboard/{c.onboardingToken}</p>
            <p className="mt-2 text-[11px] text-muted-2">{t("detail.onboardingLinkNote")}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
