import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { ReferralForm } from "./referral-form";

export const metadata = { title: "Referral partnership submission · Enshrine Portal" };

export default async function NewReferralPage() {
  const t = await getTranslations("referrals");
  return (
    <>
      <PageHeader title={t("form.title")} subtitle={t("form.subtitle")} />
      <div className="max-w-2xl">
        <ReferralForm />
      </div>
    </>
  );
}
