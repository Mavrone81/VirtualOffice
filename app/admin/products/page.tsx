import Link from "next/link";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { CommissionType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { withCurrentRates, loadPendingRateChanges } from "@/server/products/current-rates";
import { can, isFullAdmin } from "@/lib/rbac";
import { formatSGD, formatPercent, formatByValueType } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActiveToggle, EditProductLink, ComCodeManager, RequiredDocumentsManager, AshesAgreementToggle } from "./product-controls";

export const metadata = { title: "Products & commission · Enshrine Admin" };

export default async function ProductsPage() {
  const session = await auth();
  if (!session?.user || !isFullAdmin(session.user.role)) redirect("/admin/dashboard");
  // Same capability the create/edit actions enforce. The page gate above is
  // stricter today, so this is belt-and-braces if that gate is ever widened to
  // isAdminRole (which includes Accounts).
  const canManage = can(session.user.role, "manage_products");
  const t = await getTranslations("products");
  const a17On = env.A17_CLOSED_DEAL_FLOW;
  // Rates shown are the version IN FORCE today; the row's own columns mirror the
  // latest version, which may not have taken effect yet.
  const products = await withCurrentRates(
    await prisma.product.findMany({
      where: { archivedAt: null },
      include: { comCodes: true, defaultCompany: true },
      orderBy: { productCode: "asc" },
    }),
  );
  const pending = await loadPendingRateChanges(products.map((p) => p.productCode));
  const priceOf = (p: (typeof products)[number]) =>
    p.listedPrice == null ? t("priceNotSet") : `S$${p.listedPrice.toFixed(2)}`;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")}>
        {canManage && (
          <Button asChild>
            <Link href="/admin/products/new">{t("newProduct")}</Link>
          </Button>
        )}
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
                  {pending.has(p.productCode) && (
                    <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
                      {t("rateChangeScheduled", { date: format(pending.get(p.productCode)!, "dd MMM yyyy") })}
                    </span>
                  )}
                  {p.isExternal && <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] text-gold">{t("external")}</span>}
                  {a17On && <AshesAgreementToggle productId={p.id} requiresAshesAgreement={p.requiresAshesAgreement} />}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {p.productCategory ?? "—"} · {p.defaultCompany?.name ?? t("noDefaultEntity")} · eff. {format(p.effectiveDate, "dd MMM yyyy")}
                </div>
              </div>
              <div className="flex items-start gap-6">
                <div className="text-right text-[12px]">
                  <div className="text-muted">{t("listedPriceLabel")}</div>
                  <div className={`font-display text-[18px] ${p.listedPrice == null ? "text-muted-2" : "text-ink"}`}>{priceOf(p)}</div>
                  {canManage && (
                    <div className="flex justify-end gap-3">
                      <EditProductLink productId={p.id} canManage={canManage} />
                    </div>
                  )}
                </div>
                <div className="text-right text-[12px]">
                  <div className="text-muted">{t("closing")}</div>
                  <div className="font-display text-[18px] text-ink">
                    {p.commissionType === CommissionType.Fixed ? formatSGD(p.closingCommFixed ?? 0) : formatPercent(p.closingCommPct ?? 0)}
                  </div>
                </div>
              </div>
            </div>

            {!p.isExternal ? (
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-muted">
                <span>{t("companyCutLabel")} <b className="text-ink">{formatByValueType(p.companyCutPct, p.companyCutType)}</b></span>
                <span>{t("smLabel")} <b className="text-ink">{formatByValueType(p.smOverridePct, p.smOverrideType)}</b></span>
                <span>{t("sdLabel")} <b className="text-ink">{formatByValueType(p.sdOverridePct, p.sdOverrideType)}</b></span>
              </div>
            ) : (
              <div className="mt-3 text-[12px] text-muted">
                {t("externalRetains")} <b className="text-ink">{formatPercent(p.externalCompanyRetainedPct ?? 0)}</b>, {t("bulkToProvider")}
              </div>
            )}

            <ComCodeManager
              productId={p.id}
              comCodes={p.comCodes.map((c) => ({ id: c.id, comCode: c.comCode, label: c.label, valueType: c.valueType, value: c.value.toString(), active: c.active }))}
            />

            {a17On && (
              <RequiredDocumentsManager
                productId={p.id}
                requiredDocuments={p.requiredDocuments as { key: string; label_en: string; label_zh: string }[]}
              />
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
