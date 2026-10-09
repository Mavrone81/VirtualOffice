// Product edit: the combined "edit product" admin screen — name/category/
// default company + commission structure + pricing, in ONE action
// (updateProduct); everything createProduct takes except productCode.
// Real Postgres, real auditTx. Same one-row-per-productCode model as
// pricing.integration.test.ts: updateProduct edits the row by id, and must
// never touch the columns the requiredDocuments/ashes-flag actions own. A
// commission change writes a new rate version — see
// product-edit-commission.integration.test.ts for the money-doesn't-move proof.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";
import { createProduct, updateProduct, type ProductInput } from "./actions";
import type { ProductDetailsRawInput } from "@/lib/schemas";

const TAG = "PRODEDIT-";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN = { user: { id: ADMIN_ID, associateId: null, role: "Admin" } };
const ACCOUNTS = { user: { id: "33333333-3333-3333-3333-333333333333", associateId: null, role: "Accounts" } };
const ASSOCIATE = { user: { id: "44444444-4444-4444-4444-444444444444", associateId: null, role: "SalesAssociate" } };

const BASE_RATES = {
  commissionType: "Percentage" as const,
  closingCommPct: "10",
  companyCutPct: "2",
  smOverridePct: "5",
  sdOverridePct: "3",
  isExternal: false,
  effectiveDate: "2099-01-01",
};
const BASE_COMMISSION = { productName: "Fake edit product", ...BASE_RATES };
const BASE_PRICING = { listedPrice: "999.99" };
const BASE_DETAILS: ProductDetailsRawInput = { productName: "Fake edit product", ...BASE_RATES, ...BASE_PRICING };

let companyId = "";

beforeAll(async () => {
  await installAuditFault();
  who.session = ADMIN;
  companyId = (await prisma.company.create({
    data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true },
    select: { id: true },
  })).id;
});
afterEach(clearAuditFaults);
afterAll(async () => {
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
  await removeAuditFault();
});

async function freshProduct(code: string, pricing: Partial<ProductInput> = {}) {
  const r = await createProduct({ productCode: code, ...BASE_COMMISSION, ...BASE_PRICING, ...pricing } as ProductInput);
  expect(r).toEqual({ ok: true });
  return (await prisma.product.findFirstOrThrow({ where: { productCode: code } })).id;
}

/** Seeded via a RAW prisma.product.create, deliberately NOT via
 *  createProduct/pricingData() — same reasoning as pricing.integration.test.ts:
 *  a test proving updateProduct doesn't clobber columns it should leave alone must not rely on the shared pricingData() helper to have set the
 *  baseline correctly, or a bug there would move the fixture and the code
 *  under test together and the comparison would never notice. */
async function seedProductRaw(code: string) {
  return prisma.product.create({
    data: {
      productCode: code, productName: "Fake edit product (raw seed)", productCategory: "Original Category",
      commissionType: "Percentage", closingCommPct: "10", companyCutPct: "2",
      smOverridePct: "5", sdOverridePct: "3", isExternal: false,
      effectiveDate: new Date("2099-01-01"),
      listedPrice: "999.99", discountedPrice: "888.88",
    },
  });
}

describe("updateProduct — role gate: the manage_products capability, which Accounts does not hold", () => {
  let productId = "";
  beforeAll(async () => {
    who.session = ADMIN;
    productId = await freshProduct(TAG + "GATE1");
  });

  it("Accounts is refused — requireAdmin gates on can(role, \"manage_products\"), which is Admin-only, not on membership of the admin area", async () => {
    who.session = ACCOUNTS;
    const r = await updateProduct(productId, { ...BASE_DETAILS, productName: "Renamed" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    who.session = ADMIN;
  });

  it("a plain associate is refused too (the floor case, not sufficient alone)", async () => {
    who.session = ASSOCIATE;
    const r = await updateProduct(productId, { ...BASE_DETAILS, productName: "Renamed" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    who.session = ADMIN;
  });

  it("Admin succeeds", async () => {
    who.session = ADMIN;
    const r = await updateProduct(productId, { ...BASE_DETAILS, productName: "Renamed" });
    expect(r).toEqual({ ok: true });
  });
});

describe("updateProduct — productCode is structurally READ-ONLY", () => {
  it("a payload carrying productCode is rejected (.strict()), and the actual column is untouched — the single link from a historical sale line back to a product must never be renamed through this screen", async () => {
    const id = await freshProduct(TAG + "RO1");
    const before = await prisma.product.findUniqueOrThrow({ where: { id } });
    const r = await updateProduct(id, { ...BASE_DETAILS, productCode: TAG + "HIJACKED" } as unknown as ProductDetailsRawInput);
    expect(r).toEqual({ ok: false, error: "invalidInput" });
    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.productCode).toBe(before.productCode);
  });

  it("an unknown key is still rejected (.strict()), not silently ignored", async () => {
    const id = await freshProduct(TAG + "RO2");
    const r = await updateProduct(id, { ...BASE_DETAILS, notAField: "x" } as unknown as ProductDetailsRawInput);
    expect(r).toEqual({ ok: false, error: "invalidInput" });
  });
});

describe("updateProduct — actually updates name/category/default company together with pricing", () => {
  it("a real edit changes all four at once, in one call", async () => {
    const id = await freshProduct(TAG + "EDIT1");
    const r = await updateProduct(id, {
      productName: "New Name", productCategory: "New Category", defaultCompanyId: companyId, ...BASE_RATES,
      listedPrice: "1500.00", discountedPrice: "1200.00",
    });
    expect(r).toEqual({ ok: true });
    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.productName).toBe("New Name");
    expect(after.productCategory).toBe("New Category");
    expect(after.defaultCompanyId).toBe(companyId);
    expect(after.listedPrice?.toFixed(2)).toBe("1500.00");
    expect(after.discountedPrice?.toFixed(2)).toBe("1200.00");
  });

  it("productCategory/defaultCompanyId clear to null when omitted (optional fields, not 'leave whatever was there')", async () => {
    const id = await freshProduct(TAG + "EDIT2");
    const withBoth = await updateProduct(id, { productName: "X", ...BASE_RATES, productCategory: "Has A Category", defaultCompanyId: companyId, ...BASE_PRICING });
    expect(withBoth).toEqual({ ok: true });
    const r = await updateProduct(id, { productName: "X", ...BASE_RATES, ...BASE_PRICING });
    expect(r).toEqual({ ok: true });
    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.productCategory).toBeNull();
    expect(after.defaultCompanyId).toBeNull();
  });
});

describe("updateProduct — audit atomicity", () => {
  it("a positive control: a successful update writes EXACTLY ONE audit row, with before/after covering name/category/company/pricing", async () => {
    const id = await freshProduct(TAG + "AUDITOK1");
    const before = await prisma.auditLog.count({ where: { entityId: id, action: "product.details_updated" } });
    expect(before).toBe(0);

    const r = await updateProduct(id, { productName: "Audited Name", ...BASE_RATES, productCategory: "Audited Category", defaultCompanyId: companyId, listedPrice: "42.00" });
    expect(r).toEqual({ ok: true });

    const rows = await prisma.auditLog.findMany({ where: { entityId: id, action: "product.details_updated" } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].beforeJson)).toContain("Fake edit product"); // BASE_COMMISSION's productName
    expect(JSON.stringify(rows[0].beforeJson)).toContain("999.99"); // BASE_PRICING's listedPrice
    expect(JSON.stringify(rows[0].afterJson)).toContain("Audited Name");
    expect(JSON.stringify(rows[0].afterJson)).toContain("Audited Category");
    expect(JSON.stringify(rows[0].afterJson)).toContain(companyId);
    expect(JSON.stringify(rows[0].afterJson)).toContain("42.00");
  });

  it("the audit write failing rolls back the PRODUCT UPDATE that already ran before it in the same tx — writes NO audit row and leaves every field unchanged", async () => {
    const id = await freshProduct(TAG + "AUDITFAIL1");
    const before = await prisma.product.findUniqueOrThrow({ where: { id } });

    await failAuditsFor("product.details_updated");
    const r = await updateProduct(id, { productName: "Should Not Stick", ...BASE_RATES, ...BASE_PRICING });
    expect(r).toEqual({ ok: false, error: "auditUnavailable" });

    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.productName).toBe(before.productName);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "product.details_updated" } })).toBe(0);
  });
});

describe("updateProduct vs the columns it must not rewrite", () => {
  it("updateProduct, sent the commission values the row already holds, leaves those columns and effectiveDate untouched and writes no rate version", async () => {
    const seeded = await seedProductRaw(TAG + "NOCLOBBER2");
    const r = await updateProduct(seeded.id, { productName: "Renamed Only", ...BASE_RATES, listedPrice: "42.00" });
    expect(r).toEqual({ ok: true });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(after.productName).toBe("Renamed Only"); // proves updateProduct DID run
    expect(after.closingCommPct?.toFixed(4)).toBe(seeded.closingCommPct?.toFixed(4));
    expect(after.companyCutPct.toFixed(4)).toBe(seeded.companyCutPct.toFixed(4));
    expect(after.effectiveDate.toISOString()).toBe(seeded.effectiveDate.toISOString());
    expect(await prisma.commissionStructureVersion.count({ where: { productCode: seeded.productCode } })).toBe(0);
  });
});

describe("updateProduct — server nulls/replaces what an empty plan list doesn't call for (same rule as the pricing-only edit, through the merged action)", () => {
  it("dropping every plan nulls bookingFee and clears the plan rows, even if the caller sends a stale bookingFee back", async () => {
    const id = await freshProduct(TAG + "NULLOUT1", {
      bookingFee: "50.00", instalmentPlans: [{ months: 12, monthlyAmount: "41.66" }, { months: 24, monthlyAmount: "20.83" }],
    });
    const r = await updateProduct(id, {
      productName: "Fake edit product", ...BASE_RATES, listedPrice: "999.99",
      bookingFee: "50.00", instalmentPlans: [],
    });
    expect(r).toEqual({ ok: true });
    const row = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.bookingFee).toBeNull();
    expect(await prisma.productInstalmentPlan.count({ where: { productId: id } })).toBe(0);
  });
});
