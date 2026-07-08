import Link from "next/link";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { CommissionType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActiveToggle, ComCodeManager } from "./product-controls";

export const metadata = { title: "Products & commission · Enshrine Admin" };

export default async function ProductsPage() {
  const session = await auth();
  if (!session?.user || !isFullAdmin(session.user.role)) redirect("/admin/dashboard");
  const t = await getTranslations("products");
  const products = await prisma.product.findMany({
    where: { archivedAt: null },
    include: { comCodes: true, defaultCompany: true },
    orderBy: { productCode: "asc" },
  });

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")}>
        <Button asChild>
          <Link href="/admin/products/new">{t("newProduct")}</Link>
        </Button>
      </PageHeader>

      <div className="space-y-4">
        {products.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{p.productCode}</span>
                  <span className="text-ink">· {p.productName}</span>
                  <ActiveToggle id={p.id} active={p.activeStatus === "Active"} />
                  {p.isExternal && <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] text-gold">{t("external")}</span>}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {p.productCategory ?? "—"} · {p.defaultCompany?.name ?? t("noDefaultEntity")} · eff. {format(p.effectiveDate, "dd MMM yyyy")}
                </div>
              </div>
              <div className="text-right text-[12px]">
                <div className="text-muted">{t("closing")}</div>
                <div className="font-display text-[18px] text-ink">
                  {p.commissionType === CommissionType.Fixed ? `S$${p.closingCommFixed ?? 0}` : `${p.closingCommPct ?? 0}%`}
                </div>
              </div>
            </div>

            {!p.isExternal ? (
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-muted">
                <span>{t("companyCutLabel")} <b className="text-ink">{String(p.companyCutPct)}%</b></span>
                <span>{t("asmLabel")} <b className="text-ink">{String(p.asmOverridePct)}%</b></span>
                <span>{t("smLabel")} <b className="text-ink">{String(p.smOverridePct)}%</b></span>
                <span>{t("sdLabel")} <b className="text-ink">{String(p.sdOverridePct)}%</b></span>
              </div>
            ) : (
              <div className="mt-3 text-[12px] text-muted">
                {t("externalRetains")} <b className="text-ink">{String(p.externalCompanyRetainedPct ?? 0)}%</b>, {t("bulkToProvider")}
              </div>
            )}

            <ComCodeManager
              productId={p.id}
              comCodes={p.comCodes.map((c) => ({ id: c.id, comCode: c.comCode, label: c.label, valueType: c.valueType, value: c.value.toString(), active: c.active }))}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
