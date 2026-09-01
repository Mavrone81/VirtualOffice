import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Agreements · Enshrine Admin" };

// All Storage of Pets Ashes agreements (consolidated menu, Sep 2026).
export default async function AdminAgreementsPage() {
  const t = await getTranslations("agreements");
  const agreements = await prisma.petsAshesAgreement.findMany({
    orderBy: { updatedAt: "desc" },
    include: { submission: { include: { closingAssociate: { select: { fullName: true, associateCode: true } } } } },
  });

  return (
    <>
      <PageHeader title={t("list.title")} subtitle={t("list.adminSubtitle")} />
      <Card className="overflow-hidden">
        {agreements.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">{t("list.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("list.colClient")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colNiche")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colAssociate")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colUpdated")}</th>
                  <th className="px-5 py-3 font-medium">{t("list.colStatus")}</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((a) => (
                  <tr key={a.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-ink">{a.applicant1Name}</td>
                    <td className="px-5 py-3 text-muted">{a.nicheUnit ?? "—"}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(a.amountNumeric)}</td>
                    <td className="px-5 py-3 text-muted">
                      {a.submission.closingAssociate.fullName} ({a.submission.closingAssociate.associateCode})
                    </td>
                    <td className="px-5 py-3 text-muted">{format(a.updatedAt, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3"><StatusPill status={a.status} /></td>
                    <td className="px-5 py-3 text-right">
                      {a.agreementPdfKey ? (
                        <a href={`/api/files/${a.agreementPdfKey}`} target="_blank" rel="noopener" className="text-[12px] text-action hover:underline">
                          {t("list.viewPdf")}
                        </a>
                      ) : (
                        <Link href={`/portal/sales/${a.submissionId}/agreement`} className="text-[12px] text-action hover:underline">
                          {t("list.open")}
                        </Link>
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
