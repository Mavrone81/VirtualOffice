import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { ProductForm } from "./product-form";

export const metadata = { title: "New product · Enshrine Admin" };

export default async function NewProductPage() {
  const companies = await prisma.company.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="New product" subtitle="Define a product and its commission structure." />
      <ProductForm companies={companies} today={format(new Date(), "yyyy-MM-dd")} />
    </>
  );
}
