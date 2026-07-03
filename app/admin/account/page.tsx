import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { ChangePasswordForm } from "@/components/account/change-password-form";

export const metadata = { title: "Account · Enshrine Admin" };

export default async function AdminAccountPage() {
  const t = await getTranslations("account");
  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <ChangePasswordForm />
    </>
  );
}
