import { redirect, notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { EditProductForm } from "./edit-product-form";
import type { PricingValue } from "../../pricing-card";
import type { CommissionValue } from "../../commission-card";
import { earliestRateChangeDate } from "@/server/products/commission-edit";

export const metadata = { title: "Edit product · Enshrine Admin" };

// Product edit (name / category / default company / commission structure /
// pricing) — the screen for updateProduct. Same capability as that action
// (`manage_products`), not isAdminRole: Accounts passes the /admin area gate
// but not this one. Product code is the only field that stays read-only (see
// productDetailsSchema).
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
      description: true,
      defaultCompanyId: true,
      commissionType: true,
      closingCommPct: true,
      closingCommFixed: true,
      companyCutPct: true,
      companyCutType: true,
      smOverridePct: true,
      smOverrideType: true,
      sdOverridePct: true,
      mdCutPct: true,
      mdCutType: true,
      sdOverrideType: true,
      isExternal: true,
      externalCompanyRetainedPct: true,
      effectiveDate: true,
      listedPrice: true,
      discountedPrice: true,
      closingBasis: true,
      bookingFee: true,
      instalmentPlans: { select: { months: true, monthlyAmount: true }, orderBy: { months: "asc" } },
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
    bookingFee: product.bookingFee?.toFixed(2) ?? "",
    // Loaded from storage, so always `touched: true` — see pricing-card.tsx's
    // InstalmentPlanValue doc comment for why an existing saved amount is
    // never silently recomputed over.
    instalmentPlans: product.instalmentPlans.map((p) => ({ months: String(p.months), monthlyAmount: p.monthlyAmount?.toFixed(2) ?? "", touched: true })),
  };

  // Decimal.toString() drops trailing zeros ("10", not "10.0000"), which is what
  // the create form shows and what a person would type.
  const initialCommission: CommissionValue = {
    commissionType: product.commissionType,
    closingCommPct: product.closingCommPct?.toString(),
    closingCommFixed: product.closingCommFixed?.toFixed(2),
    companyCutPct: product.companyCutPct.toString(),
    companyCutType: product.companyCutType,
    smOverridePct: product.smOverridePct.toString(),
    smOverrideType: product.smOverrideType,
    sdOverridePct: product.sdOverridePct.toString(),
    mdCutPct: product.mdCutPct.toString(),
    mdCutType: product.mdCutType,
    sdOverrideType: product.sdOverrideType,
    isExternal: product.isExternal,
    externalCompanyRetainedPct: product.externalCompanyRetainedPct?.toString(),
    effectiveDate: product.effectiveDate.toISOString().slice(0, 10),
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
          description: product.description ?? "",
          defaultCompanyId: product.defaultCompanyId ?? "",
          pricing: initialPricing,
          commission: initialCommission,
        }}
        earliestEffectiveDate={earliestRateChangeDate()}
      />
    </>
  );
}
