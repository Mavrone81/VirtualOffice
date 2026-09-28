"use server";

import { revalidatePath } from "next/cache";
import { CommissionType, ComValueType, ProductActiveStatus, Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { auditTx, AuditWriteError } from "@/lib/audit";
import { validate as validateInput } from "@/lib/validate";
import { productSchema, comCodeSchema, addProductRequiredDocumentSchema, MAX_REQUIRED_DOCUMENTS_PER_PRODUCT } from "@/lib/schemas";
import { generateRequirementKey } from "@/lib/product-requirement-key";
import { env } from "@/lib/env";

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
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  const err = validate(validInput);
  if (err) return { ok: false, error: t(err) };
  if (await prisma.product.findFirst({ where: { productCode: validInput.productCode.trim() } })) {
    return { ok: false, error: t("productCodeExists") };
  }
  const eff = new Date(validInput.effectiveDate);
  // Tier A (commission input): the change and its record commit together.
  try {
    await prisma.$transaction(async (db) => {
    const product = await db.product.create({
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
    await db.commissionStructureVersion.create({
      data: { productCode: product.productCode, productId: product.id, effectiveDate: eff, rateSnapshot: rateSnapshot(validInput) },
    });
    await auditTx(db, { action: "product.created", entityType: "Product", entityId: product.id, actorUserId: admin.user.id, after: { productCode: product.productCode, effectiveDate: eff.toISOString(), rates: rateSnapshot(validInput) } });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/products");
  return { ok: true };
}

/** New effective-dated rate version (history preserved for the engine). */
export async function changeRates(productId: string, input: ProductInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const v = validateInput(productSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  const err = validate(validInput);
  if (err) return { ok: false, error: t(err) };
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return { ok: false, error: t("notFound") };
  const eff = new Date(validInput.effectiveDate);
  // Tier A (commission input): the change and its record commit together.
  try {
    await prisma.$transaction(async (db) => {
    await db.product.update({
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
    await db.commissionStructureVersion.create({
      data: { productCode: product.productCode, productId, effectiveDate: eff, rateSnapshot: rateSnapshot(validInput) },
    });
    await auditTx(db, { action: "product.rates_changed", entityType: "Product", entityId: productId, actorUserId: admin.user.id, after: { productCode: product.productCode, effectiveDate: eff.toISOString(), rates: rateSnapshot(validInput) } });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function setProductActive(productId: string, active: boolean): Promise<{ ok: boolean }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false };
  // Tier A (commission input): the change and its record commit together.
  try {
    await prisma.$transaction(async (db) => {
    await db.product.update({
      where: { id: productId },
      data: { activeStatus: active ? ProductActiveStatus.Active : ProductActiveStatus.Inactive },
    });
    await auditTx(db, { action: active ? "product.activated" : "product.deactivated", entityType: "Product", entityId: productId, actorUserId: admin.user.id });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false };
    throw e;
  }
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
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  // Tier A (commission input): the change and its record commit together.
  try {
    await prisma.$transaction(async (db) => {
    await db.comcode.create({
      data: {
        productId,
        comCode: validInput.comCode.trim(),
        label: validInput.label.trim(),
        valueType: validInput.valueType === "Absolute" ? ComValueType.Absolute : ComValueType.Percentage,
        value: validInput.value,
        active: true,
      },
    });
    await auditTx(db, { action: "product.comcode_added", entityType: "Product", entityId: productId, actorUserId: admin.user.id, after: { comCode: validInput.comCode.trim(), valueType: validInput.valueType, value: validInput.value } });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function toggleComCode(comCodeId: string, active: boolean): Promise<{ ok: boolean }> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false };
  // Tier A (commission input): the change and its record commit together.
  try {
    await prisma.$transaction(async (db) => {
    await db.comcode.update({ where: { id: comCodeId }, data: { active } });
    await auditTx(db, { action: active ? "product.comcode_enabled" : "product.comcode_disabled", entityType: "ComCode", entityId: comCodeId, actorUserId: admin.user.id });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false };
    throw e;
  }
  revalidatePath("/admin/products");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// A-17 screen 6: per-product required documents + the Pet Ash agreement
// flag. Add/remove only (no in-place edit, no reordering) — the key is
// generated from the English label, never admin-typed (lib/product-
// requirement-key.ts), so it can't collide and editing a label later can't
// silently change the key that G3 (server/sales/actions.ts) and
// submission_documents.requirement_key already reference. Gated on
// A17_CLOSED_DEAL_FLOW: refuses exactly like a not-yet-shipped feature
// (t("notFound")) when it's off, same posture as B-9's build-now-ship-later.
// ---------------------------------------------------------------------------
// Snake_case in storage: matches the schema comment and Backend's own
// existing verifySale test fixture exactly (server/sales/
// a17-verify-sale.integration.test.ts) — G3 only ever reads `.key`, so
// nothing enforces this, but drifting from the one other place this shape
// already exists would just be confusing later.
type RequiredDocumentEntry = { key: string; label_en: string; label_zh: string };

function requiredDocumentsOf(product: { requiredDocuments: Prisma.JsonValue }): RequiredDocumentEntry[] {
  return (product.requiredDocuments as RequiredDocumentEntry[] | null) ?? [];
}

// Sentinels thrown INSIDE the transaction to short-circuit to a specific
// {ok:false} result once outside it — matching the row lock's whole point:
// nothing about the outcome can be decided from a read taken before the
// lock, so every branch (not found, at the bound, missing key) has to be
// decided from the LOCKED read, inside the same transaction as the write.
class RequirementNotFound extends Error {}
class RequirementLimitReached extends Error {}

// FOR UPDATE locks the row for the rest of the transaction — a second
// concurrent add/remove on the SAME product blocks until this one commits
// or rolls back, so the read-modify-write of the JSON list can't lose a
// concurrent change the way two unlocked reads racing to write would.
async function lockProductRequiredDocuments(db: Prisma.TransactionClient, productId: string): Promise<RequiredDocumentEntry[]> {
  const rows = await db.$queryRaw<{ required_documents: Prisma.JsonValue }[]>`
    SELECT required_documents FROM products WHERE id = ${productId}::uuid FOR UPDATE
  `;
  if (rows.length === 0) throw new RequirementNotFound();
  return requiredDocumentsOf({ requiredDocuments: rows[0].required_documents });
}

export async function addProductRequiredDocument(
  productId: string,
  input: { labelEn: string; labelZh: string },
): Promise<{ ok: boolean; error?: string; key?: string }> {
  const t = await getTranslations("errors");
  if (!env.A17_CLOSED_DEAL_FLOW) return { ok: false, error: t("notFound") };
  const v = validateInput(addProductRequiredDocumentSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };

  // Tier A (commission input — required documents gate verify's eligibility): the change and its record commit together.
  let key = "";
  try {
    await prisma.$transaction(async (db) => {
      const existing = await lockProductRequiredDocuments(db, productId);
      if (existing.length >= MAX_REQUIRED_DOCUMENTS_PER_PRODUCT) throw new RequirementLimitReached();

      key = generateRequirementKey(validInput.labelEn, existing.map((e) => e.key));
      const entry: RequiredDocumentEntry = { key, label_en: validInput.labelEn, label_zh: validInput.labelZh };
      const updated: RequiredDocumentEntry[] = [...existing, entry];

      await db.product.update({ where: { id: productId }, data: { requiredDocuments: updated as Prisma.InputJsonValue } });
      await auditTx(db, { action: "product.required_document_added", entityType: "Product", entityId: productId, actorUserId: admin.user.id, after: entry });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    if (e instanceof RequirementNotFound) return { ok: false, error: t("notFound") };
    if (e instanceof RequirementLimitReached) return { ok: false, error: t("requiredDocumentsLimitReached") };
    throw e;
  }
  revalidatePath("/admin/products");
  return { ok: true, key };
}

export async function removeProductRequiredDocument(productId: string, key: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!env.A17_CLOSED_DEAL_FLOW) return { ok: false, error: t("notFound") };
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };

  // Tier A: the change and its record commit together. Nothing else needs
  // to change — G3 checks the CURRENT product config at verify time, so an
  // already-tagged submission_documents row just stops mattering for this
  // requirement; no backfill. Re-adding the same label later regenerates
  // the same key (the slug is deterministic), so a previously tagged
  // document counts again — that's the same requirement coming back, not a
  // new one, which is the intended behavior, not a bug.
  try {
    await prisma.$transaction(async (db) => {
      const existing = await lockProductRequiredDocuments(db, productId);
      const removed = existing.find((e) => e.key === key);
      if (!removed) throw new RequirementNotFound();
      const updated = existing.filter((e) => e.key !== key);

      await db.product.update({ where: { id: productId }, data: { requiredDocuments: updated as Prisma.InputJsonValue } });
      await auditTx(db, { action: "product.required_document_removed", entityType: "Product", entityId: productId, actorUserId: admin.user.id, before: removed });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    if (e instanceof RequirementNotFound) return { ok: false, error: t("notFound") };
    throw e;
  }
  revalidatePath("/admin/products");
  return { ok: true };
}

export async function setProductAshesAgreementFlag(productId: string, requiresAshesAgreement: boolean): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  if (!env.A17_CLOSED_DEAL_FLOW) return { ok: false, error: t("notFound") };
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) return { ok: false, error: t("notFound") };

  // Tier A (drives automatic Pet Ash agreement generation at submit — A-17 §4).
  try {
    await prisma.$transaction(async (db) => {
      await db.product.update({ where: { id: productId }, data: { requiresAshesAgreement } });
      await auditTx(db, {
        action: requiresAshesAgreement ? "product.ashes_agreement_required" : "product.ashes_agreement_not_required",
        entityType: "Product",
        entityId: productId,
        actorUserId: admin.user.id,
      });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/products");
  return { ok: true };
}
