import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Customisation · Enshrine Portal" };

// Marketing customisation (consolidated menu, Sep 2026): requests are handled
// personally, at a fee — this page just points associates to the right person.
export default async function MarketingCustomisationPage() {
  const t = await getTranslations("marketing");
  return (
    <>
      <PageHeader title={t("customisation.title")} subtitle={t("customisation.subtitle")} />
      <Card className="max-w-xl p-6">
        <h3 className="font-display text-[17px] text-ink">{t("customisation.howTitle")}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("customisation.howBody")}</p>
        <p className="mt-3 text-[13px] font-medium text-ink">{t("customisation.feeNote")}</p>
      </Card>
    </>
  );
}
