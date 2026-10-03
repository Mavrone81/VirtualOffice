import { redirect, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { EditProductForm } from "./edit-product-form";
import type { PricingValue } from "../../pricing-card";

export const metadata = { title: "Edit product · Enshrine Admin" };

// Details edit (name / category / default company / pricing) — the screen for
// updateProduct. Same capability as that action (`manage_products`), not
// isAdminRole: Accounts passes the /admin area gate but not this one. Product
// code and commission stay read-only here (see productDetailsSchema).
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "manage_products")) redirect("/admin/dashboard");
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      productCode: true,
      productName: true,
      productCategory: true,
      defaultCompanyId: true,
      listedPrice: true,
      discountedPrice: true,
      closingBasis: true,
      instalmentOption: true,
      bookingFee: true,
      monthlyInstalment12: true,
      monthlyInstalment24: true,
    },
  });
  if (!product) notFound();
  // Active entities, plus the product's current one even if it has since been
  // deactivated — otherwise saving would silently swap it for another.
  const companies = await prisma.company.findMany({
    where: { OR: [{ active: true }, ...(product.defaultCompanyId ? [{ id: product.defaultCompanyId }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const t = await getTranslations("products");
  const initialPricing: PricingValue = {
    listedPrice: product.listedPrice?.toFixed(2) ?? "",
    discountedPrice: product.discountedPrice?.toFixed(2) ?? "",
    closingBasis: product.closingBasis,
    instalmentOption: product.instalmentOption,
    bookingFee: product.bookingFee?.toFixed(2) ?? "",
    monthlyInstalment12: product.monthlyInstalment12?.toFixed(2) ?? "",
    monthlyInstalment24: product.monthlyInstalment24?.toFixed(2) ?? "",
  };

  return (
    <>
      <PageHeader title={t("editProduct")} subtitle={`${product.productCode} · ${product.productName}`} />
      <EditProductForm
        productId={product.id}
        companies={companies}
        initial={{
          productName: product.productName,
          productCategory: product.productCategory ?? "",
          defaultCompanyId: product.defaultCompanyId ?? "",
          pricing: initialPricing,
        }}
      />
    </>
  );
}
