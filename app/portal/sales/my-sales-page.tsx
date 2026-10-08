// Not a page.tsx: Next.js validates page files and permits only `default`,
// `metadata` and a few known fields as exports — a named export there fails
// the build with "is not a valid Page export field". The implementation lives
// here so both the portal and the admin route can call it with their own
// basePath; each route file exports only a default.

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
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";


/** Where these links point. The admin routes render the SAME page under
 *  /admin/sales, and app/portal/layout.tsx redirects any admin out of /portal —
 *  so a hardcoded /portal link here bounces an admin straight back to the admin
 *  dashboard the moment they click it. SaleForm already took this prop for the
 *  same reason; the list and detail pages did not, which is why an admin could
 *  submit a sale and then not open it (owner, 2026-10-08). */
export async function MySalesPageWithBase({ basePath }: { basePath: string }) {
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
          <Link href={`${basePath}/new`}>{t("sales.submitSale")}</Link>
        </Button>
      </PageHeader>

      <Card className="overflow-hidden">
        {submissions.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">
            {t("sales.noSales")} <Link href={`${basePath}/new`} className="text-action">{t("sales.submitFirst")}</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colTxnId")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colDate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colClient")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colProducts")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colAmount")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("sales.colPlan")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{tc("status")}</th>
                  <th className={`px-5 py-3 ${TABLE_HEAD_CELL_CLS}`}></th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    {/* A11: the TXN-#### code exists once the sale is closed into a transaction. */}
                    <td className="px-5 py-3 font-medium text-ink whitespace-nowrap">{s.transaction?.transactionCode ?? <span className="font-normal text-muted">—</span>}</td>
                    <td className="px-5 py-3 text-muted">{format(s.salesDate, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-ink">{s.clientName}</td>
                    <td className="px-5 py-3 text-muted">{s.lineItems.map((l) => l.productName).join(", ")}</td>
                    <td className="px-5 py-3 text-ink">{formatSGD(s.saleAmount)}</td>
                    <td className="px-5 py-3 text-muted">{humanize(s.paymentPlan)}</td>
                    <td className="px-5 py-3"><StatusPill status={s.status} /></td>
                    <td className="px-5 py-3 text-right"><Link href={`${basePath}/${s.id}`} className="text-[12px] text-action hover:underline">{t("sales.view")}</Link></td>
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
