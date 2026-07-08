import { redirect } from "next/navigation";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { ProductForm } from "./product-form";

export const metadata = { title: "New product · Enshrine Admin" };

export default async function NewProductPage() {
  const session = await auth();
  if (!session?.user || !isFullAdmin(session.user.role)) redirect("/admin/dashboard");
  const t = await getTranslations("products");
  const companies = await prisma.company.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title={t("newProductTitle")} subtitle={t("newProductSubtitle")} />
      <ProductForm companies={companies} today={format(new Date(), "yyyy-MM-dd")} />
    </>
  );
}
