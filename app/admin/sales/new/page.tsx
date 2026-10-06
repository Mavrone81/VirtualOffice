import { format } from "date-fns";
import { ApprovalStatus, AssociateStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { getTranslations } from "next-intl/server";
import { SaleForm } from "@/app/portal/sales/new/sale-form";
import { fetchActiveSalesWizardProducts, toFormProducts } from "@/server/products/sales-wizard-products";

export const metadata = { title: "Submit a sale · Enshrine Admin" };

// Item 9 (owner: "admin must be able to submit product also with the same
// flow as the rest"). An admin's role already clears submitSale's only gate
// (server/sales/actions.ts — session.user.associateId, no role check), and
// an admin account carries an associate profile like anyone else; the admin
// tree simply had no page that reached it, only back-office views
// (receivable/received/transactions/verify). Same form, same action, as
// app/portal/recruitment/new/page.tsx reuses the admin's own InviteForm in
// the other direction — not a new submission flow.
export default async function AdminNewSalePage() {
  const t = await getTranslations("portal");

  const products = await fetchActiveSalesWizardProducts();
  const formProducts = toFormProducts(products);

  // Split partners — same query as the portal's own new-sale page.
  const associates = await prisma.associate.findMany({
    where: { associateStatus: AssociateStatus.Active, approvalStatus: ApprovalStatus.Approved, archivedAt: null },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  const formAssociates = associates.map((a) => ({ id: a.id, name: a.fullName }));

  return (
    <>
      <PageHeader title={t("newSale.pageTitle")} subtitle={t("newSale.pageSubtitle")} />
      <SaleForm
        products={formProducts}
        associates={formAssociates}
        today={format(new Date(), "yyyy-MM-dd")}
        basePath="/admin/sales"
      />
    </>
  );
}
