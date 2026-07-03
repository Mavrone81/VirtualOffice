import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { ProductForm } from "./product-form";

export const metadata = { title: "New product · Enshrine Admin" };

export default async function NewProductPage() {
  const t = await getTranslations("products");
  const companies = await prisma.company.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title={t("newProductTitle")} subtitle={t("newProductSubtitle")} />
      <ProductForm companies={companies} today={format(new Date(), "yyyy-MM-dd")} />
    </>
  );
}
