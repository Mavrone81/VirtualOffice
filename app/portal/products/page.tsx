import { getTranslations } from "next-intl/server";
import { ProductActiveStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

export const metadata = { title: "Products & services · Enshrine Portal" };

// Read-only catalogue (consolidated menu, Sep 2026): what an associate can
// sell today. Commission internals stay in the admin area.
export default async function PortalProductsPage() {
  const t = await getTranslations("products");

  const products = await prisma.product.findMany({
    where: { activeStatus: ProductActiveStatus.Active, archivedAt: null },
    orderBy: [{ productCategory: "asc" }, { productCode: "asc" }],
    include: { defaultCompany: true },
  });

  return (
    <>
      <PageHeader title={t("catalogue.title")} subtitle={t("catalogue.subtitle")} />
      <Card className="overflow-hidden">
        {products.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-muted">{t("catalogue.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("catalogue.colCode")}</th>
                  <th className="px-5 py-3 font-medium">{t("catalogue.colName")}</th>
                  <th className="px-5 py-3 font-medium">{t("catalogue.colCategory")}</th>
                  <th className="px-5 py-3 font-medium">{t("catalogue.colCompany")}</th>
                  <th className="px-5 py-3 font-medium">{t("catalogue.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                    <td className="px-5 py-3 font-medium text-ink">{p.productCode}</td>
                    <td className="px-5 py-3 text-ink">{p.productName}</td>
                    <td className="px-5 py-3 text-muted">{p.productCategory ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{p.defaultCompany?.name ?? "—"}</td>
                    <td className="px-5 py-3"><StatusPill status={p.activeStatus} /></td>
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
