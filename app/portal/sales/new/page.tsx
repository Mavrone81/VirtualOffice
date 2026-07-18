import { format } from "date-fns";
import { ProductActiveStatus, ApprovalStatus, AssociateStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { SaleForm, type FormProduct } from "./sale-form";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Submit a sale · Enshrine Portal" };

export default async function NewSalePage() {
  const t = await getTranslations("portal");

  const products = await prisma.product.findMany({
    where: { activeStatus: ProductActiveStatus.Active, archivedAt: null },
    include: { comCodes: { where: { active: true } }, defaultCompany: true },
    orderBy: { productCode: "asc" },
  });

  const formProducts: FormProduct[] = products.map((p) => ({
    id: p.id,
    productCode: p.productCode,
    productName: p.productName,
    companyName: p.defaultCompany?.name ?? "—",
    comCodes: p.comCodes.map((c) => ({ id: c.id, label: c.label, valueType: c.valueType, value: c.value.toString() })),
  }));

  // Split partners — active approved associates. (Team-scoping arrives with #7 Teams.)
  const associates = await prisma.associate.findMany({
    where: { associateStatus: AssociateStatus.Active, approvalStatus: ApprovalStatus.Approved, archivedAt: null },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  const formAssociates = associates.map((a) => ({ id: a.id, name: a.fullName }));

  return (
    <>
      <PageHeader title={t("newSale.pageTitle")} subtitle={t("newSale.pageSubtitle")} />
      <SaleForm products={formProducts} associates={formAssociates} today={format(new Date(), "yyyy-MM-dd")} />
    </>
  );
}
