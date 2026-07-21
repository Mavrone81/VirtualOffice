import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { ResetPasswordButton } from "./reset-password";
import { CardTitleEditor } from "./card-title-editor";
import { RevealPii } from "./reveal-pii";
import { UplineEditor } from "./upline-editor";

export const metadata = { title: "Associate · Enshrine Admin" };

// Application-form fields captured at onboarding (candidates.submitted_payload).
// NRIC / bank account are encrypted there and shown from the associate record.
type StoredPayload = {
  residentialAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactNumber?: string | null;
  maritalStatus?: string | null;
  spouseConflict?: boolean | null;
  spouseName?: string | null;
  spouseCompany?: string | null;
  spouseDesignation?: string | null;
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

export default async function AdminAssociateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("associates");
  const tCard = await getTranslations("nameCard");
  const session = await auth();
  // Resetting a login (user management) and editing another associate's card
  // are Admin-only; Accounts can view the associate but not these controls.
  const canManage = !!session?.user && isFullAdmin(session.user.role);
  const { id } = await params;
  const a = await prisma.associate.findUnique({
    where: { id },
    include: {
      directUpline: { select: { associateCode: true, fullName: true } },
      secondUpline: { select: { associateCode: true, fullName: true } },
      user: { select: { email: true, isActive: true, nameCards: { select: { customTitle: true }, take: 1 } } },
      pFile: { include: { documents: { orderBy: { filedAt: "desc" } } } },
    },
  });
  if (!a) notFound();

  // Candidate uplines for the editor (Admin only): everyone except this associate.
  const uplineChoices = canManage
    ? (await prisma.associate.findMany({
        where: { id: { not: id } },
        orderBy: { associateCode: "asc" },
        select: { associateCode: true, fullName: true, designation: true },
      })).map((u) => ({ code: u.associateCode, label: `${u.associateCode} · ${u.fullName} (${humanize(u.designation)})` }))
    : [];

  // The onboarding application + invite data live on the originating candidate
  // (converted → this associate). Absent for associates added directly by admin.
  const candidate = await prisma.candidate.findFirst({
    where: { convertedAssociateId: a.id },
    include: {
      invitedBy: { select: { email: true } },
      reviewedBy: { select: { email: true } },
      intendedDirectUpline: { select: { associateCode: true, fullName: true } },
    },
  });
  const p = (candidate?.submittedPayload as StoredPayload | null) ?? {};

  // NRIC + bank account are revealed on demand (audited on click), not here.
  const payoutDetail = a.paymentMethod === "PayNow" ? a.paynowNumber : a.bankName;

  return (
    <>
      <PageHeader title={a.fullName} subtitle={`${humanize(a.designation)} · ${a.associateCode}`}>
        <Button asChild variant="secondary"><Link href="/admin/associates">{t("detail.allAssociates")}</Link></Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-4">
              {a.photoFileKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${a.photoFileKey}`} alt={a.fullName} className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-paper-200 text-lg font-semibold text-muted">{a.fullName.slice(0, 1)}</div>
              )}
              <div className="flex items-center gap-2">
                <StatusPill status={a.approvalStatus} />
                <StatusPill status={a.associateStatus} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("detail.businessName")} value={a.businessName} />
              <Field label={t("detail.team")} value={a.teamName} />
              <Field label={t("detail.mobile")} value={a.mobileNumber} />
              <Field label={t("detail.email")} value={a.email} />
              <RevealPii associateId={a.id} field="nric" label={t("detail.nric")} hasValue={!!a.nric} canReveal={canManage} />
              <Field label={t("detail.dob")} value={a.dateOfBirth ? format(a.dateOfBirth, "dd MMM yyyy") : null} />
              <Field label={t("detail.joinDate")} value={a.joinDate ? format(a.joinDate, "dd MMM yyyy") : null} />
              <Field label={t("detail.directUpline")} value={a.directUpline ? `${a.directUpline.associateCode} · ${a.directUpline.fullName}` : null} />
              <Field label={t("detail.secondUpline")} value={a.secondUpline ? `${a.secondUpline.associateCode} · ${a.secondUpline.fullName}` : null} />
              <Field
                label={t("detail.login")}
                value={a.user ? `${a.user.email}${a.user.isActive ? "" : ` ${t("detail.loginDisabled")}`}` : t("detail.loginNotProvisioned")}
              />
              <Field label={t("detail.payout")} value={a.paymentMethod ? `${humanize(a.paymentMethod)}${payoutDetail ? ` · ${payoutDetail}` : ""}` : null} />
              {a.bankAccountNumber && (
                <RevealPii associateId={a.id} field="bankAccount" label={t("detail.bankAccount")} hasValue={!!a.bankAccountNumber} canReveal={canManage} />
              )}
            </div>
          </Card>

          {/* Admin-only: set the direct + second upline (positional overrides) */}
          {canManage && (
            <Card className="p-5">
              <h2 className="mb-4 font-display text-[16px] text-ink">{t("detail.uplineSection")}</h2>
              <UplineEditor
                associateId={a.id}
                choices={uplineChoices}
                initialDirect={a.directUpline?.associateCode ?? null}
                initialSecond={a.secondUpline?.associateCode ?? null}
              />
            </Card>
          )}

          {/* Full application form (from the onboarding submission) */}
          <Card className="p-5">
            <h2 className="mb-4 font-display text-[16px] text-ink">{t("detail.appFormSection")}</h2>
            {candidate ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("detail.residentialAddress")} value={p.residentialAddress} />
                <Field
                  label={t("detail.emergencyContact")}
                  value={p.emergencyContactName ? `${p.emergencyContactName}${p.emergencyContactNumber ? ` · ${p.emergencyContactNumber}` : ""}` : null}
                />
                <Field label={t("detail.maritalStatus")} value={p.maritalStatus} />
                <Field
                  label={t("detail.spouseConflict")}
                  value={
                    p.spouseConflict
                      ? `${t("detail.conflictYes")} — ${[p.spouseName, p.spouseCompany, p.spouseDesignation].filter(Boolean).join(" · ")}`
                      : p.spouseConflict === false ? t("detail.conflictNo") : null
                  }
                />
              </div>
            ) : (
              <p className="text-[13px] text-muted">{t("detail.noApplication")}</p>
            )}
          </Card>

          {/* Invite + onboarding trail */}
          <Card className="p-5">
            <h2 className="mb-4 font-display text-[16px] text-ink">{t("detail.inviteSection")}</h2>
            {candidate ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("detail.invitedBy")} value={candidate.invitedBy?.email} />
                  <Field label={t("detail.invitedOn")} value={format(candidate.createdAt, "dd MMM yyyy")} />
                  <Field label={t("detail.intendedDesignation")} value={candidate.intendedDesignation ? humanize(candidate.intendedDesignation) : null} />
                  <Field label={t("detail.intendedTeam")} value={candidate.intendedTeam} />
                  <Field label={t("detail.intendedUpline")} value={candidate.intendedDirectUpline ? `${candidate.intendedDirectUpline.associateCode} · ${candidate.intendedDirectUpline.fullName}` : null} />
                  <Field label={t("detail.commencementDate")} value={candidate.commencementDate ? format(candidate.commencementDate, "dd MMM yyyy") : null} />
                  <Field label={t("detail.onboardingStage")} value={humanize(candidate.onboardingStage)} />
                  <Field label={t("detail.agreementSigned")} value={p.agreementAcceptedAt ? format(new Date(p.agreementAcceptedAt), "dd MMM yyyy, HH:mm") : null} />
                  <Field label={t("detail.reviewedBy")} value={candidate.reviewedBy?.email} />
                </div>
                {candidate.signedAgreementFileKey && (
                  <a href={`/api/files/${candidate.signedAgreementFileKey}`} target="_blank" rel="noopener"
                    className="mt-4 inline-flex items-center gap-2 text-[13px] text-action hover:underline">
                    <FileText className="h-4 w-4" strokeWidth={1.75} /> {t("detail.agreementSigned")} ↗
                  </a>
                )}
              </>
            ) : (
              <p className="text-[13px] text-muted">{t("detail.noApplication")}</p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {a.user && canManage && (
            <Card className="p-5">
              <h2 className="mb-1 font-display text-[16px] text-ink">{t("detail.loginSection")}</h2>
              <p className="mb-3 text-[12px] text-muted">{a.user.email}</p>
              <ResetPasswordButton associateId={a.id} />
            </Card>
          )}

          {a.user && canManage && (
            <Card className="p-5">
              <h2 className="mb-3 font-display text-[16px] text-ink">{tCard("adminSection")}</h2>
              <CardTitleEditor associateId={a.id} initial={a.user.nameCards[0]?.customTitle ?? ""} />
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 font-display text-[16px] text-ink">{t("detail.pfileSection")}</h2>
            {!a.pFile || a.pFile.documents.length === 0 ? (
              <p className="text-[13px] text-muted">{t("detail.noDocuments")}</p>
            ) : (
              <div className="space-y-2">
                {a.pFile.documents.map((d) => (
                  <a key={d.id} href={`/api/files/${d.fileKey}`} target="_blank" rel="noopener"
                    className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-paper-100">
                    <FileText className="h-4 w-4 shrink-0 text-action" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-ink">{d.title}</div>
                      <div className="text-[11px] text-muted-2">{humanize(d.docType)} · {format(d.filedAt, "dd MMM yyyy")}</div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
