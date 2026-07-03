import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { ChangePasswordForm } from "@/components/account/change-password-form";

export const metadata = { title: "Account · Enshrine Portal" };

export default async function PortalAccountPage() {
  const t = await getTranslations("account");
  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <ChangePasswordForm />
    </>
  );
}
