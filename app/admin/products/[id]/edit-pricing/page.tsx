import { redirect, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { EditPricingForm } from "./edit-pricing-form";
import type { PricingValue } from "../../pricing-card";

export const metadata = { title: "Edit pricing · Enshrine Admin" };

// Pricing-only edit (2026-09-30): opens the same PricingCard the create
// form uses, prefilled — never commission, code or effectiveDate, those stay
// on their existing paths (changeRates / the create form).
export default async function EditProductPricingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !isFullAdmin(session.user.role)) redirect("/admin/dashboard");
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      productCode: true,
      productName: true,
      listedPrice: true,
      discountedPrice: true,
      instalmentOption: true,
      bookingFee: true,
      monthlyInstalment12: true,
      monthlyInstalment24: true,
    },
  });
  if (!product) notFound();

  const t = await getTranslations("products");
  const initial: PricingValue = {
    listedPrice: product.listedPrice?.toFixed(2) ?? "",
    discountedPrice: product.discountedPrice?.toFixed(2) ?? "",
    instalmentOption: product.instalmentOption,
    bookingFee: product.bookingFee?.toFixed(2) ?? "",
    monthlyInstalment12: product.monthlyInstalment12?.toFixed(2) ?? "",
    monthlyInstalment24: product.monthlyInstalment24?.toFixed(2) ?? "",
  };

  return (
    <>
      <PageHeader title={t("editPricing")} subtitle={`${product.productCode} · ${product.productName}`} />
      <EditPricingForm productId={product.id} initial={initial} />
    </>
  );
}
