import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { OnboardingStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { decryptPII, maskNric, maskAccount } from "@/lib/crypto";
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

function safeDecrypt(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try { return decryptPII(blob); } catch { return null; }
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-2">{label}</div>
      <div className="mt-0.5 text-[13px] text-ink">{value || "—"}</div>
    </div>
  );
}

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
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
  const submitted = c.onboardingStage !== OnboardingStage.Invited;
  const reviewable =
    c.onboardingStage === OnboardingStage.SignedPendingApproval || c.onboardingStage === OnboardingStage.FormSubmitted;

  return (
    <>
      <PageHeader title={c.fullName} subtitle={`${humanize(c.intendedDesignation ?? "")} · invited ${format(c.createdAt, "dd MMM yyyy")}`}>
        <StatusPill status={c.onboardingStage} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 font-display text-[16px] text-ink">Intended placement</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" value={c.email} />
              <Field label="Mobile" value={c.mobileNumber} />
              <Field label="Designation" value={humanize(c.intendedDesignation ?? "")} />
              <Field label="Direct upline" value={c.intendedDirectUpline ? `${c.intendedDirectUpline.associateCode} · ${c.intendedDirectUpline.fullName}` : null} />
              <Field label="Team" value={c.intendedTeam} />
              <Field label="Invited by" value={c.invitedBy?.email} />
            </div>
          </Card>

          {submitted ? (
            <Card className="p-5">
              <h2 className="mb-4 font-display text-[16px] text-ink">Submitted details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" value={p.businessName} />
                <Field label="NRIC / FIN" value={maskNric(safeDecrypt(p.nric))} />
                <Field label="Date of birth" value={p.dateOfBirth ? format(new Date(p.dateOfBirth), "dd MMM yyyy") : null} />
                <Field label="Residential address" value={p.residentialAddress} />
                <Field label="Emergency contact" value={p.emergencyContactName ? `${p.emergencyContactName} · ${p.emergencyContactNumber ?? ""}` : null} />
                <Field label="Payment method" value={p.paymentMethod} />
                {p.paymentMethod === "PayNow"
                  ? <Field label="PayNow" value={p.paynowNumber} />
                  : <Field label="Bank account" value={p.bankName ? `${p.bankName} · ${maskAccount(safeDecrypt(p.bankAccountNumber))}` : null} />}
                <Field label="Agreement signed" value={p.agreementAcceptedAt ? format(new Date(p.agreementAcceptedAt), "dd MMM yyyy, HH:mm") : null} />
              </div>
            </Card>
          ) : (
            <Card className="p-5 text-[13px] text-muted">
              The candidate has not opened their onboarding link yet. Once they submit their details and sign the
              Associate Agreement, their information will appear here for review.
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {reviewable && (
            <Card className="p-5">
              <h2 className="mb-3 font-display text-[16px] text-ink">Review</h2>
              <p className="mb-4 text-[12px] text-muted">
                Approving creates the associate record, provisions their portal login, and files the signed agreement in
                their P-file.
              </p>
              <ReviewActions id={c.id} />
            </Card>
          )}

          {c.onboardingStage === OnboardingStage.Approved && c.convertedAssociate && (
            <Card className="p-5">
              <div className="text-[13px] text-success">✓ Converted to associate</div>
              <Button asChild variant="secondary" className="mt-3 w-full">
                <Link href="/admin/associates">View {c.convertedAssociate.associateCode}</Link>
              </Button>
            </Card>
          )}

          {c.onboardingStage === OnboardingStage.Rejected && (
            <Card className="p-5">
              <div className="text-[13px] font-medium text-danger">Rejected</div>
              {c.rejectReason && <p className="mt-2 text-[12px] text-muted">{c.rejectReason}</p>}
            </Card>
          )}

          <Card className="p-5">
            <div className="text-[11px] uppercase tracking-wide text-muted-2">Onboarding link</div>
            <p className="mt-2 break-all font-mono text-[11px] text-body">/onboard/{c.onboardingToken}</p>
            <p className="mt-2 text-[11px] text-muted-2">Share this private path with the candidate to (re)open their form.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
