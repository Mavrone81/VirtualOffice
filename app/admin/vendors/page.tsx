import { format } from "date-fns";
import { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { VendorStatusToggle } from "./status-toggle";
import { ReferralApprovalActions } from "./approval-actions";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Referral partnerships · Enshrine Admin" };

// Referral partnership queue (consolidated menu, Sep 2026): pending
// submissions first for approval; the full registry below.
export default async function AdminVendorsPage() {
  const t = await getTranslations("vendors");
  const vendors = await prisma.vendorReferral.findMany({
    orderBy: [{ approvalStatus: "asc" }, { submittedAt: "desc" }],
    include: { submittedByAssociate: { select: { fullName: true, associateCode: true } } },
  });
  const pendingCount = vendors.filter((v) => v.approvalStatus === ApprovalStatus.Pending).length;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={pendingCount > 0 ? t("pendingSubtitle", { count: pendingCount }) : t("subtitle")}
      />

      <Card className="overflow-hidden">
        {vendors.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("col.vendor")}</th>
                  <th className="px-5 py-3 font-medium">{t("col.type")}</th>
                  <th className="px-5 py-3 font-medium">{t("col.contact")}</th>
                  <th className="px-5 py-3 font-medium">{t("col.submittedBy")}</th>
                  <th className="px-5 py-3 font-medium">{t("col.approval")}</th>
                  <th className="px-5 py-3 font-medium">{t("col.status")}</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100 align-top">
                    <td className="px-5 py-3">
                      <div className="text-ink">{v.vendorName}</div>
                      {v.remarks && <div className="text-[11px] text-muted-2">{v.remarks}</div>}
                      {v.rejectReason && (
                        <div className="text-[11px] text-danger">{t("rejectedBecause", { reason: v.rejectReason })}</div>
                      )}
                      {v.agreementPdfKey ? (
                        <a href={`/api/files/${v.agreementPdfKey}`} target="_blank" rel="noopener" className="text-[11px] text-action hover:underline">
                          {t("viewAgreement")}
                        </a>
                      ) : v.agreementFileKey ? (
                        <a href={`/api/files/${v.agreementFileKey}`} target="_blank" rel="noopener" className="text-[11px] text-action hover:underline">
                          {t("viewAgreement")}
                        </a>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-muted">{v.vendorType ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{v.contact ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">
                      {v.submittedByAssociate ? `${v.submittedByAssociate.fullName} (${v.submittedByAssociate.associateCode})` : "—"}
                      <div className="text-[11px] text-muted-2">{format(v.submittedAt, "dd MMM yyyy")}</div>
                    </td>
                    <td className="px-5 py-3"><StatusPill status={v.approvalStatus} /></td>
                    <td className="px-5 py-3"><StatusPill status={v.status} /></td>
                    <td className="px-5 py-3 text-right">
                      {v.approvalStatus === ApprovalStatus.Pending ? (
                        <ReferralApprovalActions id={v.id} />
                      ) : (
                        <VendorStatusToggle id={v.id} status={v.status} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
