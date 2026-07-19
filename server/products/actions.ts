"use server";

import { revalidatePath } from "next/cache";
import { CommissionType, ComValueType, ProductActiveStatus, Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { validate as validateInput } from "@/lib/validate";
import { productSchema, comCodeSchema } from "@/lib/schemas";

// Managing products / com codes / rates is Admin-only (docs/05_RBAC.md §3).
async function requireAdmin() {
  const session = await auth();
  if (!session || !can(session.user.role, "manage_products")) return null;
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
  companyCutType?: "Percentage" | "Absolute";
  smOverridePct: string;
  smOverrideType?: "Percentage" | "Absolute";
  sdOverridePct: string;
  sdOverrideType?: "Percentage" | "Absolute";
  isExternal: boolean;
  externalCompanyRetainedPct?: string;
  defaultCompanyId?: string;
  effectiveDate: string;
};

const valueType = (v?: "Percentage" | "Absolute") => (v === "Absolute" ? ComValueType.Absolute : ComValueType.Percentage);

function rateSnapshot(i: ProductInput) {
  return {
    commissionType: i.commissionType,
    closingCommPct: i.closingCommPct ?? null,
    closingCommFixed: i.closingCommFixed ?? null,
    companyCutPct: i.companyCutPct,
    companyCutType: i.companyCutType ?? "Percentage",
    smOverridePct: i.smOverridePct,
    smOverrideType: i.smOverrideType ?? "Percentage",
    sdOverridePct: i.sdOverridePct,
    sdOverrideType: i.sdOverrideType ?? "Percentage",
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
  const v = validateInput(productSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };
  const err = validate(validInput);
  if (err) return { ok: false, error: t(err) };
  if (await prisma.product.findFirst({ where: { productCode: validInput.productCode.trim() } })) {
    return { ok: false, error: t("productCodeExists") };
  }
  const eff = new Date(validInput.effectiveDate);
  const product = await prisma.product.create({
    data: {
      productCode: validInput.productCode.trim(),
      productName: validInput.productName.trim(),
      productCategory: validInput.productCategory?.trim() || null,
      commissionType: validInput.commissionType === "Fixed" ? CommissionType.Fixed : CommissionType.Percentage,
      closingCommPct: validInput.commissionType === "Percentage" ? validInput.closingCommPct : null,
      closingCommFixed: validInput.commissionType === "Fixed" ? validInput.closingCommFixed : null,
      companyCutPct: validInput.companyCutPct || "0",
      companyCutType: valueType(validInput.companyCutType),
      smOverridePct: validInput.smOverridePct || "0",
      smOverrideType: valueType(validInput.smOverrideType),
      sdOverridePct: validInput.sdOverridePct || "0",
      sdOverrideType: valueType(validInput.sdOverrideType),
      isExternal: validInput.isExternal,
      externalCompanyRetainedPct: validInput.isExternal ? validInput.externalCompanyRetainedPct || "0" : null,
      defaultCompanyId: validInput.defaultCompanyId || null,
      activeStatus: ProductActiveStatus.Active,
      effectiveDate: eff,
    },
  });
  await prisma.commissionStructureVersion.create({
    data: { productCode: product.productCode, productId: product.id, effectiveDate: eff, rateSnapshot: rateSnapshot(validInput) },
  });
  await logAudit({ action: "product.created", entityType: "Product", entityId: product.id });
  revalidatePath("/admin/products");
  return { ok: true };
}

/** New effective-dated rate version (history preserved for the engine). */
export async function changeRates(productId: string, input: ProductInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const v = validateInput(productSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };
  const err = validate(validInput);
  if (err) return { ok: false, error: t(err) };
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return { ok: false, error: t("notFound") };
  const eff = new Date(validInput.effectiveDate);
  await prisma.product.update({
    where: { id: productId },
    data: {
      commissionType: validInput.commissionType === "Fixed" ? CommissionType.Fixed : CommissionType.Percentage,
      closingCommPct: validInput.commissionType === "Percentage" ? validInput.closingCommPct : null,
      closingCommFixed: validInput.commissionType === "Fixed" ? validInput.closingCommFixed : null,
      companyCutPct: validInput.companyCutPct || "0",
      companyCutType: valueType(validInput.companyCutType),
      smOverridePct: validInput.smOverridePct || "0",
      smOverrideType: valueType(validInput.smOverrideType),
      sdOverridePct: validInput.sdOverridePct || "0",
      sdOverrideType: valueType(validInput.sdOverrideType),
      isExternal: validInput.isExternal,
      externalCompanyRetainedPct: validInput.isExternal ? validInput.externalCompanyRetainedPct || "0" : null,
      effectiveDate: eff,
    },
  });
  await prisma.commissionStructureVersion.create({
    data: { productCode: product.productCode, productId, effectiveDate: eff, rateSnapshot: rateSnapshot(validInput) },
  });
  await logAudit({ action: "product.rates_changed", entityType: "Product", entityId: productId });
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function setProductActive(productId: string, active: boolean): Promise<{ ok: boolean }> {
  if (!(await requireAdmin())) return { ok: false };
  await prisma.product.update({
    where: { id: productId },
    data: { activeStatus: active ? ProductActiveStatus.Active : ProductActiveStatus.Inactive },
  });
  await logAudit({ action: active ? "product.activated" : "product.deactivated", entityType: "Product", entityId: productId });
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function addComCode(
  productId: string,
  input: { comCode: string; label: string; valueType: "Percentage" | "Absolute"; value: string },
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const v = validateInput(comCodeSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;
  if (!(await requireAdmin())) return { ok: false, error: t("forbidden") };
  await prisma.comcode.create({
    data: {
      productId,
      comCode: validInput.comCode.trim(),
      label: validInput.label.trim(),
      valueType: validInput.valueType === "Absolute" ? ComValueType.Absolute : ComValueType.Percentage,
      value: validInput.value,
      active: true,
    },
  });
  await logAudit({ action: "product.comcode_added", entityType: "Product", entityId: productId });
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function toggleComCode(comCodeId: string, active: boolean): Promise<{ ok: boolean }> {
  if (!(await requireAdmin())) return { ok: false };
  await prisma.comcode.update({ where: { id: comCodeId }, data: { active } });
  await logAudit({ action: active ? "product.comcode_enabled" : "product.comcode_disabled", entityType: "ComCode", entityId: comCodeId });
  revalidatePath("/admin/products");
  return { ok: true };
}
