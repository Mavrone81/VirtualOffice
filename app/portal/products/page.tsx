import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getPortalProductCatalogue } from "@/server/products/portal-catalogue";
import { ProductCard } from "./product-card";

export const metadata = { title: "Products & services · Enshrine Portal" };

// What an associate can sell today: price, instalment plan, and commission
// (2026-09-30 — pricing is no longer admin-only, but commission structure
// stays internal: company cut is not shown here, and is selected out of the
// read entirely in server/products/portal-catalogue.ts, not just left out of
// this page's rendering).
export default async function PortalProductsPage() {
  const t = await getTranslations("products");
  const tc = await getTranslations("common");
  const cards = await getPortalProductCatalogue();

  return (
    <>
      <PageHeader title={t("catalogue.title")} subtitle={t("catalogue.subtitle")} />
      {cards.length === 0 ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted">{t("catalogue.empty")}</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((p) => (
            <ProductCard key={p.id} p={p} t={t} tc={tc} />
          ))}
        </div>
      )}
    </>
  );
}
