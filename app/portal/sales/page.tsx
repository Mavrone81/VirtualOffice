import Link from "next/link";
import { format } from "date-fns";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { humanize } from "@/lib/labels";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "My sales · Enshrine Portal" };

export default async function MySalesPage() {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;

  const t = await getTranslations("portal");
  const tc = await getTranslations("common");

  const submissions = associateId
    ? await prisma.salesSubmission.findMany({
        where: { closingAssociateId: associateId },
        orderBy: { createdAt: "desc" },
        include: { lineItems: true, transaction: true },
      })
    : [];

  return (
    <>
      <PageHeader title={t("sales.pageTitle")} subtitle={t("sales.pageSubtitle")}>
        <Button asChild>
          <Link href="/portal/sales/new">{t("sales.submitSale")}</Link>
        </Button>
      </PageHeader>

      <Card className="overflow-hidden">
        {submissions.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">
            {t("sales.noSales")} <Link href="/portal/sales/new" className="text-action">{t("sales.submitFirst")}</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("sales.colDate")}</th>
                  <th className="px-5 py-3 font-medium">{t("sales.colClient")}</th>
                  <th className="px-5 py-3 font-medium">{t("sales.colProducts")}</th>
                  <th className="px-5 py-3 font-medium">{t("sales.colAmount")}</th>
                  <th className="px-5 py-3 font-medium">{t("sales.colPlan")}</th>
                  <th className="px-5 py-3 font-medium">{tc("status")}</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 text-muted">{format(s.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{s.clientName}</td>
                    <td className="px-5 py-3 text-muted">{s.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(s.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(s.paymentPlan)}</td>
                    <td className="px-5 py-3"><StatusPill status={s.status} /></td>
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
