import { notFound, redirect } from "next/navigation";
import { SubmissionStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { formatSGD } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { AshesAgreementForm } from "./agreement-form";
import type { AshesPet } from "@/lib/pdf/ashes-agreement";

export const dynamic = "force-dynamic";
export const metadata = { title: "Storage of Pets Ashes Agreement · Enshrine Portal" };

// Application-details step (consolidated menu, Sep 2026): after the quotation
// is approved+signed the associate fills this form; the data auto-fills the
// Storage of Pets Ashes Agreement, which the client signs in person below.
export default async function AshesAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const t = await getTranslations("agreements");

  const sub = await prisma.salesSubmission.findUnique({
    where: { id },
    include: { ashesAgreement: true, lineItems: { select: { productName: true } } },
  });
  if (!sub) notFound();
  const mine = !!session.user.associateId && session.user.associateId === sub.closingAssociateId;
  if (!mine && !isAdminRole(session.user.role)) notFound();
  if (sub.status !== SubmissionStatus.QuotationApproved) redirect("/portal/quotations");

  const a = sub.ashesAgreement;
  return (
    <>
      <PageHeader
        title={t("form.title")}
        subtitle={`${sub.clientName} · ${sub.lineItems.map((l) => l.productName).join(", ")} · ${formatSGD(sub.saleAmount)} · ${humanize(sub.paymentPlan)}`}
      />
      <div className="max-w-3xl">
        <AshesAgreementForm
          submissionId={sub.id}
          isInstalment={sub.paymentPlan === "Installment"}
          signed={a?.status === "Signed"}
          agreementPdfKey={a?.agreementPdfKey ?? null}
          initial={{
            storageSpaceLocation: a?.storageSpaceLocation ?? "",
            nicheUnit: a?.nicheUnit ?? sub.lineItems.map((l) => l.productName).join(", "),
            pets: ((a?.pets as AshesPet[] | undefined) ?? []).length ? (a?.pets as AshesPet[]) : [{}],
            applicant1Name: a?.applicant1Name ?? sub.clientName,
            applicant1Nric: a?.applicant1Nric ?? "",
            applicant1Address: a?.applicant1Address ?? "",
            applicant1Contact: a?.applicant1Contact ?? sub.clientContact ?? "",
            applicant1Email: a?.applicant1Email ?? "",
            applicant2Name: a?.applicant2Name ?? "",
            applicant2Nric: a?.applicant2Nric ?? "",
            applicant2Address: a?.applicant2Address ?? "",
            applicant2Contact: a?.applicant2Contact ?? "",
            applicant2Email: a?.applicant2Email ?? "",
            instalmentDayOfMonth: a?.instalmentDayOfMonth ?? 1,
            maintenanceStartYear: a?.maintenanceStartYear ?? new Date().getFullYear() + 1,
            additionalTerms: a?.additionalTerms ?? "",
            applicantWitnessName: a?.applicantWitnessName ?? "",
            applicantWitnessNric: a?.applicantWitnessNric ?? "",
            companyWitnessName: a?.companyWitnessName ?? "",
            companyWitnessNric: a?.companyWitnessNric ?? "",
          }}
        />
      </div>
    </>
  );
}
