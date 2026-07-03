"use server";

import { revalidatePath } from "next/cache";
import { CommissionType, ComValueType, ProductActiveStatus, Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

export type ProductInput = {
  productCode: string;
  productName: string;
  productCategory?: string;
  commissionType: "Percentage" | "Fixed";
  closingCommPct?: string;
  closingCommFixed?: string;
  companyCutPct: string;
  asmOverridePct: string;
  smOverridePct: string;
  sdOverridePct: string;
  isExternal: boolean;
  externalCompanyRetainedPct?: string;
  defaultCompanyId?: string;
  effectiveDate: string;
};

function rateSnapshot(i: ProductInput) {
  return {
    commissionType: i.commissionType,
    closingCommPct: i.closingCommPct ?? null,
    closingCommFixed: i.closingCommFixed ?? null,
    companyCutPct: i.companyCutPct,
    asmOverridePct: i.asmOverridePct,
    smOverridePct: i.smOverridePct,
    sdOverridePct: i.sdOverridePct,
    isExternal: i.isExternal,
    externalCompanyRetainedPct: i.externalCompanyRetainedPct ?? null,
  } satisfies Prisma.InputJsonValue;
}

function validate(i: ProductInput): string | null {
  if (!i.productCode?.trim() || !i.productName?.trim()) return "codeAndNameRequired";
  if (i.commissionType === "Percentage" && !i.closingCommPct) return "closingPctRequired";
  if (i.commissionType === "Fixed" && !i.closingCommFixed) return "closingFixedRequired";
  return null;
}

export async function createProduct(input: ProductInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };
  const err = validate(input);
  if (err) return { ok: false, error: t(err) };
  if (await prisma.product.findFirst({ where: { productCode: input.productCode.trim() } })) {
    return { ok: false, error: t("productCodeExists") };
  }
  const eff = new Date(input.effectiveDate);
  const product = await prisma.product.create({
    data: {
      productCode: input.productCode.trim(),
      productName: input.productName.trim(),
      productCategory: input.productCategory?.trim() || null,
      commissionType: input.commissionType === "Fixed" ? CommissionType.Fixed : CommissionType.Percentage,
      closingCommPct: input.commissionType === "Percentage" ? input.closingCommPct : null,
      closingCommFixed: input.commissionType === "Fixed" ? input.closingCommFixed : null,
      companyCutPct: input.companyCutPct || "0",
      asmOverridePct: input.asmOverridePct || "0",
      smOverridePct: input.smOverridePct || "0",
      sdOverridePct: input.sdOverridePct || "0",
      isExternal: input.isExternal,
      externalCompanyRetainedPct: input.isExternal ? input.externalCompanyRetainedPct || "0" : null,
      defaultCompanyId: input.defaultCompanyId || null,
      activeStatus: ProductActiveStatus.Active,
      effectiveDate: eff,
    },
  });
  await prisma.commissionStructureVersion.create({
    data: { productCode: product.productCode, productId: product.id, effectiveDate: eff, rateSnapshot: rateSnapshot(input) },
  });
  revalidatePath("/admin/products");
  return { ok: true };
}

/** New effective-dated rate version (history preserved for the engine). */
export async function changeRates(productId: string, input: ProductInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };
  const err = validate(input);
  if (err) return { ok: false, error: t(err) };
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return { ok: false, error: t("notFound") };
  const eff = new Date(input.effectiveDate);
  await prisma.product.update({
    where: { id: productId },
    data: {
      commissionType: input.commissionType === "Fixed" ? CommissionType.Fixed : CommissionType.Percentage,
      closingCommPct: input.commissionType === "Percentage" ? input.closingCommPct : null,
      closingCommFixed: input.commissionType === "Fixed" ? input.closingCommFixed : null,
      companyCutPct: input.companyCutPct || "0",
      asmOverridePct: input.asmOverridePct || "0",
      smOverridePct: input.smOverridePct || "0",
      sdOverridePct: input.sdOverridePct || "0",
      isExternal: input.isExternal,
      externalCompanyRetainedPct: input.isExternal ? input.externalCompanyRetainedPct || "0" : null,
      effectiveDate: eff,
    },
  });
  await prisma.commissionStructureVersion.create({
    data: { productCode: product.productCode, productId, effectiveDate: eff, rateSnapshot: rateSnapshot(input) },
  });
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function setProductActive(productId: string, active: boolean): Promise<{ ok: boolean }> {
  if (!(await requireAdmin())) return { ok: false };
  await prisma.product.update({
    where: { id: productId },
    data: { activeStatus: active ? ProductActiveStatus.Active : ProductActiveStatus.Inactive },
  });
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function addComCode(
  productId: string,
  input: { comCode: string; label: string; valueType: "Percentage" | "Absolute"; value: string },
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };
  if (!input.comCode?.trim() || !input.label?.trim() || !input.value) return { ok: false, error: t("allFieldsRequired") };
  await prisma.comcode.create({
    data: {
      productId,
      comCode: input.comCode.trim(),
      label: input.label.trim(),
      valueType: input.valueType === "Absolute" ? ComValueType.Absolute : ComValueType.Percentage,
      value: input.value,
      active: true,
    },
  });
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function toggleComCode(comCodeId: string, active: boolean): Promise<{ ok: boolean }> {
  if (!(await requireAdmin())) return { ok: false };
  await prisma.comcode.update({ where: { id: comCodeId }, data: { active } });
  revalidatePath("/admin/products");
  return { ok: true };
}
