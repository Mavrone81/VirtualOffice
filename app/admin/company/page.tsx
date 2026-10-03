import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isFullAdmin } from "@/lib/rbac";
import { getCompanySignatory, listCompanyDetails } from "@/server/company/actions";
import { PageHeader } from "@/components/ui/page-header";
import { CompanySignatoryForm } from "./company-signatory-form";
import { CompanyDetailsForm } from "./company-details-form";

export const metadata = { title: "Company Data · Enshrine Admin" };

// Company details (registration numbers, contact details) and, below them,
// CR-0001: the signatory identity stamped on every new associate agreement.
// Stricter than the rest of /admin — Admin only, not Accounts (see
// server/company/actions.ts's requireFullAdmin for why).
export default async function CompanyDataPage() {
  const session = await auth();
  if (!session?.user || !isFullAdmin(session.user.role)) redirect("/admin/dashboard");
  const t = await getTranslations("company");
  const r = await getCompanySignatory();
  if (!r.ok || !r.data) redirect("/admin/dashboard");
  const details = await listCompanyDetails();
  if (!details.ok) redirect("/admin/dashboard");

  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <CompanyDetailsForm rows={details.data} />
      <CompanySignatoryForm initial={r.data} />
    </>
  );
}
