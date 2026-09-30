// Product pricing (2026-09-30): real Postgres, real auditTx. Product is ONE
// ROW PER productCode in practice (createProduct refuses an existing code;
// changeRates updates that same row in place, measured 2026-09-30) —
// so there is no version-selection concern here: updateProductPricing
// edits the row by id, and the two write paths (changeRates for commission,
// updateProductPricing for pricing) must never clobber each other's columns.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";
import { createProduct, changeRates, updateProductPricing, type ProductInput } from "./actions";
import type { ProductPricingInput } from "@/lib/schemas";

const TAG = "PRICING-";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN = { user: { id: ADMIN_ID, associateId: null, role: "Admin" } };
const ACCOUNTS = { user: { id: "33333333-3333-3333-3333-333333333333", associateId: null, role: "Accounts" } };
const ASSOCIATE = { user: { id: "44444444-4444-4444-4444-444444444444", associateId: null, role: "SalesAssociate" } };

const BASE_COMMISSION = {
  productName: "Fake pricing product",
  commissionType: "Percentage" as const,
  closingCommPct: "10",
  companyCutPct: "2",
  smOverridePct: "5",
  sdOverridePct: "3",
  isExternal: false,
  effectiveDate: "2099-01-01",
};

const BASE_PRICING = {
  listedPrice: "999.99",
  instalmentOption: "None" as const,
};

let productId = "";

beforeAll(async () => {
  await installAuditFault();
  who.session = ADMIN;
});
afterEach(clearAuditFaults);
afterAll(async () => {
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await removeAuditFault();
});

async function freshProduct(code: string, pricing: Partial<ProductInput> = {}) {
  const r = await createProduct({ productCode: code, ...BASE_COMMISSION, ...BASE_PRICING, ...pricing } as ProductInput);
  expect(r).toEqual({ ok: true });
  return (await prisma.product.findFirstOrThrow({ where: { productCode: code } })).id;
}

/** Seeds a product row via a RAW prisma.product.create — deliberately NOT
 *  via createProduct/pricingData() — so a test proving one write path
 *  (changeRates or updateProductPricing) doesn't clobber the OTHER path's
 *  columns isn't itself relying on the shared pricingData() helper to have
 *  set the baseline correctly. A bug in pricingData() would otherwise
 *  contaminate both the fixture and the code under test identically,
 *  making a before/after comparison pass even when it clobbers (caught
 *  empirically while mutation-testing this file: createProduct and
 *  updateProductPricing share pricingData(), so mutating it moved BOTH the
 *  fixture and the write path together, and the relative comparison never
 *  noticed). */
async function seedProductRaw(code: string) {
  return prisma.product.create({
    data: {
      productCode: code, productName: "Fake pricing product (raw seed)",
      commissionType: "Percentage", closingCommPct: "10", companyCutPct: "2",
      smOverridePct: "5", sdOverridePct: "3", isExternal: false,
      effectiveDate: new Date("2099-01-01"),
      listedPrice: "999.99", discountedPrice: "888.88", instalmentOption: "None",
    },
  });
}

describe("createProduct / updateProductPricing — role gate (isFullAdmin, not merely isAdminRole)", () => {
  beforeAll(async () => {
    who.session = ADMIN;
    productId = await freshProduct(TAG + "GATE1");
  });

  it("Accounts passes isAdminRole but is refused — the narrower isFullAdmin gate, not just any admin-area role", async () => {
    who.session = ACCOUNTS;
    const r = await updateProductPricing(productId, { listedPrice: "500.00", instalmentOption: "None" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    who.session = ADMIN;
  });

  it("a plain associate is refused too (the floor case, not sufficient alone)", async () => {
    who.session = ASSOCIATE;
    const r = await updateProductPricing(productId, { listedPrice: "500.00", instalmentOption: "None" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    who.session = ADMIN;
  });

  it("Admin succeeds", async () => {
    who.session = ADMIN;
    const r = await updateProductPricing(productId, { listedPrice: "500.00", instalmentOption: "None" });
    expect(r).toEqual({ ok: true });
  });
});

describe("updateProductPricing — PRICING FIELDS ONLY, structurally (.strict())", () => {
  it("a payload carrying a non-pricing key (commissionType) is rejected, and the actual column is untouched", async () => {
    const id = await freshProduct(TAG + "STRICT1");
    const before = await prisma.product.findUniqueOrThrow({ where: { id } });
    const r = await updateProductPricing(id, { listedPrice: "1.00", instalmentOption: "None", commissionType: "Fixed" } as unknown as ProductPricingInput);
    expect(r).toEqual({ ok: false, error: "invalidInput" });
    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.commissionType).toBe(before.commissionType);
    expect(after.listedPrice?.toString()).toBe(before.listedPrice?.toString());
  });
});

describe("updateProductPricing — audit atomicity", () => {
  it("a positive control: a successful update writes EXACTLY ONE audit row, with before/after pricing", async () => {
    const id = await freshProduct(TAG + "AUDITOK1");
    const before = await prisma.auditLog.count({ where: { entityId: id, action: "product.pricing_updated" } });
    expect(before).toBe(0);

    const r = await updateProductPricing(id, { listedPrice: "1234.56", discountedPrice: "999.00", instalmentOption: "None" });
    expect(r).toEqual({ ok: true });

    const rows = await prisma.auditLog.findMany({ where: { entityId: id, action: "product.pricing_updated" } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].beforeJson)).toContain("999.99"); // BASE_PRICING's listedPrice
    expect(JSON.stringify(rows[0].afterJson)).toContain("1234.56");
    expect(JSON.stringify(rows[0].afterJson)).toContain("999.00");
  });

  it("the audit write failing rolls back the PRODUCT UPDATE that already ran before it in the same tx — writes NO audit row and leaves pricing unchanged", async () => {
    const id = await freshProduct(TAG + "AUDITFAIL1");
    const before = await prisma.product.findUniqueOrThrow({ where: { id } });

    await failAuditsFor("product.pricing_updated");
    const r = await updateProductPricing(id, { listedPrice: "1.00", instalmentOption: "None" });
    expect(r).toEqual({ ok: false, error: "auditUnavailable" });

    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.listedPrice?.toString()).toBe(before.listedPrice?.toString());
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "product.pricing_updated" } })).toBe(0);
  });
});

describe("changeRates and updateProductPricing write the SAME row without clobbering each other's columns", () => {
  it("changeRates (commission path) leaves the price columns untouched", async () => {
    const seeded = await seedProductRaw(TAG + "NOCLOBBER1");
    // changeRates validates against the same productSchema as createProduct
    // (one shared shape), so its caller must still supply a syntactically
    // valid pricing payload even though changeRates never writes it — these
    // values are deliberately NOT what's asserted below; the seeded row's
    // OWN pricing (999.99 / 888.88) is what must survive untouched.
    const r = await changeRates(seeded.id, {
      productCode: TAG + "NOCLOBBER1", ...BASE_COMMISSION, closingCommPct: "25", effectiveDate: "2099-06-01",
      listedPrice: "1.00", discountedPrice: undefined, instalmentOption: "None",
    } as ProductInput);
    expect(r).toEqual({ ok: true });
    const row = await prisma.product.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(row.closingCommPct?.toFixed(4)).toBe("25.0000"); // proves changeRates DID run
    expect(row.listedPrice?.toFixed(2)).toBe("999.99"); // unchanged from the raw seed
    expect(row.discountedPrice?.toFixed(2)).toBe("888.88");
  });

  it("updateProductPricing leaves the commission and effectiveDate columns untouched", async () => {
    const seeded = await seedProductRaw(TAG + "NOCLOBBER2");
    const r = await updateProductPricing(seeded.id, { listedPrice: "42.00", instalmentOption: "None" });
    expect(r).toEqual({ ok: true });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(after.listedPrice?.toFixed(2)).toBe("42.00"); // proves updateProductPricing DID run
    expect(after.closingCommPct?.toFixed(4)).toBe(seeded.closingCommPct?.toFixed(4));
    expect(after.companyCutPct.toFixed(4)).toBe(seeded.companyCutPct.toFixed(4));
    expect(after.effectiveDate.toISOString()).toBe(seeded.effectiveDate.toISOString());
  });
});

describe("updateProductPricing — server nulls what the instalment option doesn't call for", () => {
  it("switching an existing Months12or24 product back to None nulls booking/monthly fields, even if the caller sends stale ones", async () => {
    const id = await freshProduct(TAG + "NULLOUT1", {
      instalmentOption: "Months12or24", bookingFee: "50.00", monthlyInstalment12: "41.66", monthlyInstalment24: "20.83",
    });
    // The caller sends the STALE values
    // back (a real client could easily still be holding them in its form
    // state after flipping the option to None) — pricingRefine never
    // forbids these keys when instalmentOption is "None", so this is a
    // valid payload, not a hypothetical one. Sending nothing here made all
    // three nulling branches pass vacuously (undefined ?? null is null
    // whether or not the conditional exists) — proved by mutation: this
    // exact call, with these exact stale values, is what makes it fail.
    const r = await updateProductPricing(id, {
      listedPrice: "999.99", instalmentOption: "None",
      bookingFee: "50.00", monthlyInstalment12: "41.66", monthlyInstalment24: "20.83",
    });
    expect(r).toEqual({ ok: true });
    const row = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.bookingFee).toBeNull();
    expect(row.monthlyInstalment12).toBeNull();
    expect(row.monthlyInstalment24).toBeNull();
  });
});
