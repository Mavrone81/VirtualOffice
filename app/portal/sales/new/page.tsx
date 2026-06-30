import { format } from "date-fns";
import { ProductActiveStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { SaleForm, type FormProduct } from "./sale-form";

export const metadata = { title: "Submit a sale · Enshrine Portal" };

export default async function NewSalePage() {
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

  return (
    <>
      <PageHeader title="Submit a sale" subtitle="Record a new sale — it becomes official after verification." />
      <SaleForm products={formProducts} today={format(new Date(), "yyyy-MM-dd")} />
    </>
  );
}
