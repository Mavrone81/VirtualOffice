"use server";

import { revalidatePath } from "next/cache";
import { CommissionType, ComValueType, InstalmentOption, ClosingBasis, ProductActiveStatus, Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { auditTx, AuditWriteError } from "@/lib/audit";
import { validate as validateInput } from "@/lib/validate";
import {
  productSchema,
  comCodeSchema,
  addProductRequiredDocumentSchema,
  MAX_REQUIRED_DOCUMENTS_PER_PRODUCT,
  productPricingSchema,
  type ProductPricingInput,
  type ProductPricingRawInput,
  productDetailsSchema,
  type ProductDetailsRawInput,
} from "@/lib/schemas";
import { generateRequirementKey } from "@/lib/product-requirement-key";
import { env } from "@/lib/env";
import { canonicalFromInput, canonicalFromRow, changedCommissionFields, earliestRateChangeDate, validateCommission } from "./commission-edit";
import { VERSION_RESOLUTION_ORDER } from "@/server/commission/version-order";

// Managing products / com codes / rates is Admin-only (docs/05_RBAC.md §3).
// `manage_products` is in rbac.ts's ADMIN_ONLY_CAPABILITIES, so `can(role,
// "manage_products")` is exactly `isFullAdmin(role)` today (Accounts, which
// passes `isAdminRole`, is excluded) — this ONE gate already covers both
// createProduct and updateProductPricing below; it is not a separate,
// possibly-drifting check per action.
async function requireAdmin() {
  const session = await auth();
  if (!session || !can(session.user.role, "manage_products")) return null;
  return session;
}

export type ProductInput = {
  productCode: string;
  productName: string;
  productCategory?: string;
  // Owner-requested product description — same optional/trim shape as
  // productCategory. Bounded in productSchema (lib/schemas.ts), not here.
  description?: string;
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
  // Pricing (2026-09-30) — see lib/schemas.ts productPricingShape/pricingRefine
  // for the shared shape + business rules; ProductPricingInput below. Optional
  // HERE (the raw, not-yet-validated input type) only so the pre-pricing
  // admin form still compiles while its pricing fields are optional —
  // productSchema itself still REQUIRES listedPrice/instalmentOption at
  // runtime; validateInput() below returns invalidInput if they're missing.
  listedPrice?: string;
  discountedPrice?: string;
  instalmentOption?: "None" | "Months12" | "Months12or24";
  bookingFee?: string;
  monthlyInstalment12?: string;
  monthlyInstalment24?: string;
  // Closing basis (2026-10-01) — see lib/schemas.ts closingBasisEnum/
  // pricingRefine. Optional here for the same reason the pricing fields
  // above are: productPricingSchema/productSchema default it server-side
  // (to "ListedPrice") even if a not-yet-updated caller omits it.
  closingBasis?: "ListedPrice" | "DiscountedPrice";
};

const valueType = (v?: "Percentage" | "Absolute") => (v === "Absolute" ? ComValueType.Absolute : ComValueType.Percentage);

type RateFields = Parameters<typeof canonicalFromInput>[0];

function rateSnapshot(i: RateFields) {
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
  return validateCommission(i);
}

/** The product-row commission columns (everything but effectiveDate) for a
 *  validated input — ONE mapping shared by create and the edit action. */
function commissionData(v: RateFields) {
  return {
    commissionType: v.commissionType === "Fixed" ? CommissionType.Fixed : CommissionType.Percentage,
    closingCommPct: v.commissionType === "Percentage" ? v.closingCommPct : null,
    closingCommFixed: v.commissionType === "Fixed" ? v.closingCommFixed : null,
    companyCutPct: v.companyCutPct || "0",
    companyCutType: valueType(v.companyCutType),
    smOverridePct: v.smOverridePct || "0",
    smOverrideType: valueType(v.smOverrideType),
    sdOverridePct: v.sdOverridePct || "0",
    sdOverrideType: valueType(v.sdOverrideType),
    isExternal: v.isExternal,
    externalCompanyRetainedPct: v.isExternal ? v.externalCompanyRetainedPct || "0" : null,
  };
}

function instalmentOptionOf(o: "None" | "Months12" | "Months12or24"): InstalmentOption {
  if (o === "Months12") return InstalmentOption.Months12;
  if (o === "Months12or24") return InstalmentOption.Months12or24;
  return InstalmentOption.None;
}

function closingBasisOf(b: "ListedPrice" | "DiscountedPrice"): ClosingBasis {
  return b === "DiscountedPrice" ? ClosingBasis.DiscountedPrice : ClosingBasis.ListedPrice;
}

/** Maps validated pricing input to the exact `product.update`/`.create` data
 *  shape — including nulling every instalment field the chosen option does
 *  NOT call for, unconditionally. This runs server-side regardless of what
 *  the caller sent, so a stale bookingFee/monthly value from before an
 *  option change can never survive in the DB just because the UI stopped
 *  showing its input. */
function pricingData(p: ProductPricingInput) {
  const needsInstalment = p.instalmentOption !== "None";
  const needsBothMonths = p.instalmentOption === "Months12or24";
  return {
    listedPrice: p.listedPrice,
    discountedPrice: p.discountedPrice ?? null,
    instalmentOption: instalmentOptionOf(p.instalmentOption),
    bookingFee: needsInstalment ? (p.bookingFee ?? null) : null,
    monthlyInstalment12: needsInstalment ? (p.monthlyInstalment12 ?? null) : null,
    monthlyInstalment24: needsBothMonths ? (p.monthlyInstalment24 ?? null) : null,
    closingBasis: closingBasisOf(p.closingBasis),
  };
}

type PricingColumns = {
  listedPrice: Prisma.Decimal | null;
  discountedPrice: Prisma.Decimal | null;
  instalmentOption: InstalmentOption;
  bookingFee: Prisma.Decimal | null;
  monthlyInstalment12: Prisma.Decimal | null;
  monthlyInstalment24: Prisma.Decimal | null;
  closingBasis: ClosingBasis;
};

/** Pricing-only before/after for the audit row — money values as fixed
 *  2dp decimal strings (never a JS number, and never Decimal's own
 *  toString(), which strips trailing zeros — "999.00" must read as
 *  "999.00" in the audit record, not "999"), nothing else from the product. */
function pricingSnapshot(p: PricingColumns) {
  return {
    listedPrice: p.listedPrice?.toFixed(2) ?? null,
    discountedPrice: p.discountedPrice?.toFixed(2) ?? null,
    instalmentOption: p.instalmentOption,
    bookingFee: p.bookingFee?.toFixed(2) ?? null,
    monthlyInstalment12: p.monthlyInstalment12?.toFixed(2) ?? null,
    monthlyInstalment24: p.monthlyInstalment24?.toFixed(2) ?? null,
    closingBasis: p.closingBasis,
  } satisfies Prisma.InputJsonValue;
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
        description: validInput.description?.trim() || null,
        ...commissionData(validInput),
        defaultCompanyId: validInput.defaultCompanyId || null,
        activeStatus: ProductActiveStatus.Active,
        effectiveDate: eff,
        ...pricingData(validInput),
      },
    });
    await db.commissionStructureVersion.create({
      data: { productCode: product.productCode, productId: product.id, effectiveDate: eff, rateSnapshot: rateSnapshot(validInput) },
    });
    await auditTx(db, { action: "product.created", entityType: "Product", entityId: product.id, actorUserId: admin.user.id, after: { productCode: product.productCode, effectiveDate: eff.toISOString(), rates: rateSnapshot(validInput), pricing: pricingSnapshot(product) } });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/products");
  return { ok: true };
}

// Thrown INSIDE the transaction, caught outside it — same shape as
// RequirementNotFound further down this file: the not-found decision has to
// be made from the read taken inside the transaction, not an earlier one.
class ProductNotFound extends Error {}

/** Editing an existing product's PRICING ONLY (2026-09-30) —
 *  deliberately separate from `updateProduct`, the only commission-change
 *  path (effective-dated, versioned, date-guarded): commission/companyCut
 *  changes must NOT be touched here. `productPricingSchema` is `.strict()`, so a payload
 *  carrying any other key (e.g. a stray `commissionType`) fails validation
 *  rather than silently ignoring or applying it — structural enforcement,
 *  not a convention someone could forget to follow at a call site. */
export async function updateProductPricing(productId: string, pricing: ProductPricingRawInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const v = validateInput(productPricingSchema, pricing);
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };

  const data = pricingData(validInput);
  // Tier A (money the buyer pays): the change and its record commit together.
  // `before` is read INSIDE this same transaction, immediately ahead of the
  // write — not from an earlier, un-transactional lookup — so the audit's
  // "before" is never stale against a concurrent edit landing in between.
  try {
    await prisma.$transaction(async (db) => {
      const existing = await db.product.findUnique({ where: { id: productId } });
      if (!existing) throw new ProductNotFound();
      const before = pricingSnapshot(existing);
      const updated = await db.product.update({ where: { id: productId }, data });
      await auditTx(db, {
        action: "product.pricing_updated",
        entityType: "Product",
        entityId: productId,
        actorUserId: admin.user.id,
        before,
        after: pricingSnapshot(updated),
      });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    if (e instanceof ProductNotFound) return { ok: false, error: t("notFound") };
    throw e;
  }
  revalidatePath("/admin/products");
  return { ok: true };
}

type ProductDetailsColumns = PricingColumns & Parameters<typeof canonicalFromRow>[0] & {
  productName: string;
  productCategory: string | null;
  description: string | null;
  defaultCompanyId: string | null;
};

/** Details-edit before/after for the audit row — name/category/default
 *  company, the full commission structure (`rates`, canonical fixed-scale
 *  strings, effective date included) and the pricing snapshot. Nothing else
 *  from the product. */
function productDetailsSnapshot(p: ProductDetailsColumns) {
  return {
    productName: p.productName,
    productCategory: p.productCategory,
    description: p.description,
    defaultCompanyId: p.defaultCompanyId,
    rates: canonicalFromRow(p),
    ...pricingSnapshot(p),
  } satisfies Prisma.InputJsonValue;
}

// Thrown INSIDE the transaction (same shape as ProductNotFound). A rate change's
// effective date may not be in the past (it would reprice pending, unverified
// sales — see RATE_CHANGE_FLOOR_DAYS_AHEAD) and may not be EARLIER than the
// product's latest version. The same date as the latest version IS allowed: a
// same-day correction resolves to the newest version deterministically
// (VERSION_RESOLUTION_ORDER: effectiveDate, then createdAt).
class CommissionInvalid extends Error {
  constructor(readonly key: "closingPctRequired" | "closingFixedRequired") { super(key); }
}
class EffectiveDateInPast extends Error {}
class EffectiveDateBeforeLatestVersion extends Error {}

/** Editing an existing product — everything `createProduct` takes EXCEPT
 *  productCode: name/category/default company, the commission structure and
 *  pricing, in one screen and one transaction.
 *  `productDetailsSchema` is `.strict()`, so productCode is structurally
 *  READ-ONLY: it is the one link from a historical sale line (which carries
 *  only a copied productCode, no productId) and from CommissionStructureVersion
 *  back to a product, so renaming it would orphan both. A caller that sends it
 *  fails validation rather than it being silently applied or dropped.
 *
 *  MONEY ALREADY EARNED MUST NOT MOVE. The engine pays from the
 *  CommissionStructureVersion a sale line was resolved to when it was verified
 *  (server/commission/run.ts reads `li.structureVersion.rateSnapshot`), never
 *  from the product row. So when any commission field or the effective date
 *  changes, this writes a NEW version (never edits an old one) and updates the product columns as the current-values
 *  mirror (portal catalogue, admin list, preview). Verified sale lines keep
 *  their version link, so nothing already computed changes; only sales
 *  verified from the new effective date on resolve to the new rates. An edit
 *  that leaves the commission fields as they were writes no version.
 *  requiredDocuments/requiresAshesAgreement are LIVE by design and have their
 *  own add/remove/toggle actions — this one never reads or writes them. */
export async function updateProduct(productId: string, input: ProductDetailsRawInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const v = validateInput(productDetailsSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  // A real date (the schema bounds only the string's envelope).
  const eff = new Date(validInput.effectiveDate);
  if (Number.isNaN(eff.getTime())) return { ok: false, error: t("invalidInput") };

  // Name/category/company/pricing are written on EVERY edit. The commission
  // block (columns + effective date + a new rate version) is written ONLY when
  // the person actually changed it — see below.
  const baseData = {
    productName: validInput.productName.trim(),
    productCategory: validInput.productCategory?.trim() || null,
    description: validInput.description?.trim() || null,
    defaultCompanyId: validInput.defaultCompanyId || null,
    ...pricingData(validInput),
  };
  // Tier A (money the buyer pays AND what people are paid): the change and its
  // record commit together. `before` is read INSIDE this same transaction,
  // after a row lock, immediately ahead of the write — so the audit's "before"
  // is never stale against a concurrent edit, and two concurrent rate edits
  // can't both pass the effective-date check below.
  try {
    await prisma.$transaction(async (db) => {
      const locked = await db.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new ProductNotFound();
      const existing = await db.product.findUnique({ where: { id: productId } });
      if (!existing) throw new ProductNotFound();
      const before = productDetailsSnapshot(existing);

      const changedRates = changedCommissionFields(canonicalFromRow(existing), canonicalFromInput(validInput));
      if (changedRates.length > 0) {
        const invalid = validateCommission(validInput);
        if (invalid) throw new CommissionInvalid(invalid);
        const effDay = eff.toISOString().slice(0, 10);
        if (effDay < earliestRateChangeDate()) throw new EffectiveDateInPast();
        const latest = await db.commissionStructureVersion.findFirst({
          where: { productCode: existing.productCode },
          orderBy: [...VERSION_RESOLUTION_ORDER],
          select: { effectiveDate: true },
        });
        if (latest && effDay < latest.effectiveDate.toISOString().slice(0, 10)) throw new EffectiveDateBeforeLatestVersion();
      }

      // Validation and the date rules apply only to a commission the person
      // CHANGED. An edit that leaves the block as stored (a rename, a price
      // edit) is never gated on it — pre-existing invalid commission data
      // (e.g. a null closing %) must not block unrelated edits, and the stored
      // values are not rewritten.
      const data = changedRates.length > 0 ? { ...baseData, ...commissionData(validInput), effectiveDate: eff } : baseData;
      const updated = await db.product.update({ where: { id: productId }, data });
      let rateVersionId: string | null = null;
      if (changedRates.length > 0) {
        const version = await db.commissionStructureVersion.create({
          data: { productCode: existing.productCode, productId, effectiveDate: eff, rateSnapshot: rateSnapshot(validInput) },
        });
        rateVersionId = version.id;
      }
      await auditTx(db, {
        action: "product.details_updated",
        entityType: "Product",
        entityId: productId,
        actorUserId: admin.user.id,
        before,
        after: { ...productDetailsSnapshot(updated), changedRates, rateVersionId },
      });
      if (changedRates.length > 0) {
        // A dedicated rate-change record, so a query for rate changes finds
        // every one (this is the only rate-change path).
        await auditTx(db, {
          action: "product.rates_changed",
          entityType: "Product",
          entityId: productId,
          actorUserId: admin.user.id,
          before: { productCode: existing.productCode, rates: canonicalFromRow(existing) },
          after: { productCode: existing.productCode, rates: canonicalFromRow(updated), changedRates, rateVersionId },
        });
      }
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    if (e instanceof ProductNotFound) return { ok: false, error: t("notFound") };
    if (e instanceof CommissionInvalid) return { ok: false, error: t(e.key) };
    if (e instanceof EffectiveDateInPast) return { ok: false, error: t("effectiveDateInPast") };
    if (e instanceof EffectiveDateBeforeLatestVersion) return { ok: false, error: t("effectiveDateBeforeLatestVersion") };
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

// ---------------------------------------------------------------------------
// Hard delete, allowed ONLY for a product with no history of any kind.
//
// 🔴 The owner's ruling is the whole point of this feature: "Delete cannot work
// if product is sold it can only be deactivated." The refusal is the feature,
// not an edge case — so none of the four conditions below may be loosened to
// make delete succeed more often. If a product has history, the answer is the
// Active toggle (setProductActive above), which is a separate control and stays.
//
// 🔴 This is a HARD delete and it must stay one. Product.archivedAt exists and is
// READ as a filter in four places (app/admin/products/page.tsx,
// app/admin/commission/page.tsx, server/products/portal-catalogue.ts,
// server/products/sales-wizard-products.ts) but is WRITTEN by nothing in the
// codebase. Setting it here instead of deleting would make the product vanish
// from every list and look like a working delete, while the row — and its
// productCode, which @@unique([productCode, effectiveDate]) still reserves —
// stayed behind. That is a worse outcome than either deleting or refusing.
//
// WHY A SALE DOES NOT NEED THE PRODUCT ROW, and where the real risk is:
// SaleLineItem has no productId and no Product relation. It stores productCode
// and productName as its own text, so a sale's record is self-contained and
// deleting a product does not corrupt it. The danger runs the other way.
//
// 🔴 THREE OF THE FOUR CONDITIONS GUARD AGAINST SILENT DAMAGE, NOT AGAINST AN
// ERROR. Read the delete rules off the database rather than assuming RESTRICT —
// only ONE of these refuses anything:
//     com_codes_product_id_fkey                     RESTRICT
//     commission_structure_versions_product_id_fkey SET NULL
//     products_parent_product_id_fkey               SET NULL
//     sale_line_items_structure_version_id_fkey     SET NULL
//     (upgrade_parent_product_id)                   no FK at all
// So without these counts Postgres would not complain, it would quietly rewrite
// history: (b)'s uuid left dangling with no constraint to catch it, (c)'s child
// product keeping its row while parentProductId is blanked — the upgrade
// relationship destroyed with no error raised anywhere — and (a)'s line item
// keeping its row while structureVersionId is blanked, severing the sale from the
// rate snapshot it was actually priced with. Every one of those leaves row counts
// unchanged, which is exactly why the tests assert the LINKS and not just counts.
type ProductDeleteBlock =
  | "productDeleteBlockedBySale"
  | "productDeleteBlockedByUpgradeSale"
  | "productDeleteBlockedByUpgradeChild"
  | "productDeleteBlockedByProductCode";

export async function deleteProduct(productId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };

  let outcome: { ok: true } | { ok: false; key: ProductDeleteBlock | "notFound" };
  try {
    outcome = await prisma.$transaction(
      async (db): Promise<{ ok: true } | { ok: false; key: ProductDeleteBlock | "notFound" }> => {
        const product = await db.product.findUnique({
          where: { id: productId },
          select: { productCode: true, productName: true },
        });
        if (!product) return { ok: false, key: "notFound" };

        // (a) A line item pointing at one of THIS product's commission versions.
        // Counted FIRST on purpose: the version cleanup further down is only safe
        // once we know no line item references any of those rows.
        if (await db.saleLineItem.count({ where: { structureVersion: { productId } } })) {
          return { ok: false, key: "productDeleteBlockedBySale" };
        }
        // (b) The unconstrained uuid. No FK exists, so this count is the only guard.
        if (await db.saleLineItem.count({ where: { upgradeParentProductId: productId } })) {
          return { ok: false, key: "productDeleteBlockedByUpgradeSale" };
        }
        // (c) Another product names this one as its upgrade parent (ProductUpgrade).
        if (await db.product.count({ where: { parentProductId: productId } })) {
          return { ok: false, key: "productDeleteBlockedByUpgradeChild" };
        }
        // (d) The backstop, and NOT redundant with (a): structureVersionId is
        // NULLABLE, so a line item without one slips past (a) entirely and a
        // productCode match is the only link left. Deliberately conservative —
        // because @@unique([productCode, effectiveDate]) lets one code have many
        // product rows, this can refuse a brand-new version of a long-sold code.
        // That cost is accepted: refusing a deletable product is recoverable,
        // deleting a product with history is not.
        if (await db.saleLineItem.count({ where: { productCode: product.productCode } })) {
          return { ok: false, key: "productDeleteBlockedByProductCode" };
        }

        // Its com codes are its own: Comcode.productId is NOT NULL and nothing
        // else references them, so they go with the product.
        await db.comcode.deleteMany({ where: { productId } });
        // Its commission versions are NOT solely its own — SaleLineItem.
        // structureVersionId is a real FK into them and the model declares
        // `lineItems SaleLineItem[]`, so sales history points straight at these
        // rows. (a) has already established that none are referenced; the
        // `lineItems: { none: {} }` scope restates that as a condition of the
        // delete, so a referenced row could never be removed even if (a) were
        // ever weakened. Scoped by productId, never productCode: a sibling
        // product sharing the code has its own versions and must keep them.
        await db.commissionStructureVersion.deleteMany({ where: { productId, lineItems: { none: {} } } });
        await db.product.delete({ where: { id: productId } });
        await auditTx(db, {
          action: "product.deleted",
          entityType: "Product",
          entityId: productId,
          actorUserId: admin.user.id,
          before: { productCode: product.productCode, productName: product.productName },
        });
        return { ok: true };
      },
      // 🔴 Serializable, not the default Read Committed, and this was MEASURED
      // rather than assumed. The requirement is that a product which passes "never
      // sold" and is then sold a moment later must not be deleted. Two concurrent
      // transactions were run against a real database — this delete, and a sale
      // committing in between the counts and the delete:
      //
      //   read committed : delete COMMITTED, product gone, line item left dangling
      //   serializable   : delete ABORTED (40001/P2034), product still there
      //
      // The repo's usual race idiom, `SELECT ... FOR UPDATE`
      // (server/payouts/actions.ts), cannot help here: there is no existing row to
      // lock, the conflict is with a row that does not exist yet.
      //
      // WHAT MAKES IT WORK, and therefore its limit: SSI aborts on a CYCLE, not on
      // a single read-write conflict. This transaction reads sale_line_items and
      // writes products; a real sale reads the product (it needs the code and the
      // rates) and writes sale_line_items — the two together close the cycle, so
      // Postgres has to abort one of them. A writer that inserted a line item
      // pointing at this product WITHOUT ever reading the product row would form no
      // cycle and would NOT be caught; verified, and it is why the counts above are
      // the primary guard and this is the backstop, not the reverse. No such writer
      // exists in the app today, and an FK on upgrade_parent_product_id would be the
      // real fix for one that did.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    // P2034 = serialization failure, P2028 = transaction timeout. Both mean the
    // delete did not happen and retrying is safe — the same reading these codes
    // get in server/payouts/actions.ts. Nothing was destroyed.
    if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2028", "P2034"].includes(e.code)) {
      return { ok: false, error: t("productDeleteConflict") };
    }
    throw e;
  }
  if (!outcome.ok) return { ok: false, error: t(outcome.key) };
  revalidatePath("/admin/products");
  revalidatePath("/admin/commission");
  return { ok: true };
}
