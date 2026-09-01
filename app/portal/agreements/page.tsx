import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { transactionScopeIds } from "@/lib/transaction-scope";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agreements · Enshrine Portal" };

// Storage of Pets Ashes agreements in the viewer's scope (consolidated menu,
// Sep 2026) — same visibility ladder as transactions.
export default async function PortalAgreementsPage() {
  const session = await auth();
  const t = await getTranslations("agreements");
  if (!session?.user) return null;

  const ids = await transactionScopeIds(session.user.role, session.user.associateId ?? null);
  const agreements = await prisma.petsAshesAgreement.findMany({
    where: ids === null ? {} : { submission: { closingAssociateId: { in: ids } } },
    orderBy: { updatedAt: "desc" },
    include: { submission: { include: { closingAssociate: { select: { fullName: true } } } } },
  });

  return (
    <>
      <PageHeader title={t("list.title")} subtitle={t("list.subtitle")} />
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
                    <td className="px-5 py-3 text-muted">{a.submission.closingAssociate.fullName}</td>
                    <td className="px-5 py-3 text-muted">{format(a.updatedAt, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3"><StatusPill status={a.status} /></td>
                    <td className="px-5 py-3 text-right">
                      {a.agreementPdfKey ? (
                        <a href={`/api/files/${a.agreementPdfKey}`} target="_blank" rel="noopener" className="text-[12px] text-action hover:underline">
                          {t("list.viewPdf")}
                        </a>
                      ) : (
                        <Link href={`/portal/sales/${a.submissionId}/agreement`} className="text-[12px] text-action hover:underline">
                          {t("list.continue")}
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
      <p className="mt-4 text-[12.5px] text-muted-2">
        {t("list.legacyNote")}{" "}
        <Link href="/portal/sales-agreements" className="text-action hover:underline">{t("list.legacyLink")}</Link>
      </p>
    </>
  );
}
