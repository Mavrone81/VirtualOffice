import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isFullAdmin } from "@/lib/rbac";
import { getCompanySignatory } from "@/server/company/actions";
import { PageHeader } from "@/components/ui/page-header";
import { CompanySignatoryForm } from "./company-signatory-form";

export const metadata = { title: "Company Data · Enshrine Admin" };

// CR-0001: the signatory identity stamped on every new associate agreement.
// Stricter than the rest of /admin — Admin only, not Accounts (see
// server/company/actions.ts's requireFullAdmin for why).
export default async function CompanyDataPage() {
  const session = await auth();
  if (!session?.user || !isFullAdmin(session.user.role)) redirect("/admin/dashboard");
  const t = await getTranslations("company");
  const r = await getCompanySignatory();
  if (!r.ok || !r.data) redirect("/admin/dashboard");

  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <CompanySignatoryForm initial={r.data} />
    </>
  );
}
