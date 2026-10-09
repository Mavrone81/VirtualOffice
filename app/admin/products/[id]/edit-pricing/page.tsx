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
// on their existing paths (the product edit screen / the create form).
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
      closingBasis: true,
      bookingFee: true,
      instalmentPlans: { select: { months: true, monthlyAmount: true }, orderBy: { months: "asc" } },
    },
  });
  if (!product) notFound();

  const t = await getTranslations("products");
  const initial: PricingValue = {
    listedPrice: product.listedPrice?.toFixed(2) ?? "",
    discountedPrice: product.discountedPrice?.toFixed(2) ?? "",
    closingBasis: product.closingBasis,
    bookingFee: product.bookingFee?.toFixed(2) ?? "",
    // Loaded from storage, so always `touched: true` — see pricing-card.tsx's
    // InstalmentPlanValue doc comment for why an existing saved amount is
    // never silently recomputed over.
    instalmentPlans: product.instalmentPlans.map((p) => ({ months: String(p.months), monthlyAmount: p.monthlyAmount?.toFixed(2) ?? "", touched: true })),
  };

  return (
    <>
      <PageHeader title={t("editPricing")} subtitle={`${product.productCode} · ${product.productName}`} />
      <EditPricingForm productId={product.id} initial={initial} />
    </>
  );
}
