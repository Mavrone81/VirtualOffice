// Product pricing (2026-09-30): real Postgres, real auditTx. Product is ONE
// ROW PER productCode in practice (createProduct refuses an existing code;
// updateProduct updates that same row in place) —
// so there is no version-selection concern here: updateProductPricing
// edits the row by id and must never clobber the commission columns.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";
import { createProduct, updateProductPricing, type ProductInput } from "./actions";
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
 *  (updateProductPricing) doesn't clobber the OTHER columns'
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
      // closingBasis deliberately NOT the default (ListedPrice) — a clobber
      // that reset it back to the default would otherwise be indistinguishable
      // from "left untouched" in the assertions below.
      listedPrice: "999.99", discountedPrice: "888.88", closingBasis: "DiscountedPrice",
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
    const r = await updateProductPricing(productId, { listedPrice: "500.00" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    who.session = ADMIN;
  });

  it("a plain associate is refused too (the floor case, not sufficient alone)", async () => {
    who.session = ASSOCIATE;
    const r = await updateProductPricing(productId, { listedPrice: "500.00" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    who.session = ADMIN;
  });

  it("Admin succeeds", async () => {
    who.session = ADMIN;
    const r = await updateProductPricing(productId, { listedPrice: "500.00" });
    expect(r).toEqual({ ok: true });
  });
});

describe("updateProductPricing — PRICING FIELDS ONLY, structurally (.strict())", () => {
  it("a payload carrying a non-pricing key (commissionType) is rejected, and the actual column is untouched", async () => {
    const id = await freshProduct(TAG + "STRICT1");
    const before = await prisma.product.findUniqueOrThrow({ where: { id } });
    const r = await updateProductPricing(id, { listedPrice: "1.00", commissionType: "Fixed" } as unknown as ProductPricingInput);
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

    const r = await updateProductPricing(id, { listedPrice: "1234.56", discountedPrice: "999.00" });
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
    const r = await updateProductPricing(id, { listedPrice: "1.00" });
    expect(r).toEqual({ ok: false, error: "auditUnavailable" });

    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.listedPrice?.toString()).toBe(before.listedPrice?.toString());
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "product.pricing_updated" } })).toBe(0);
  });
});

describe("updateProductPricing does not clobber the commission columns", () => {
  it("updateProductPricing leaves the commission and effectiveDate columns untouched", async () => {
    const seeded = await seedProductRaw(TAG + "NOCLOBBER2");
    const r = await updateProductPricing(seeded.id, { listedPrice: "42.00" });
    expect(r).toEqual({ ok: true });
    const after = await prisma.product.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(after.listedPrice?.toFixed(2)).toBe("42.00"); // proves updateProductPricing DID run
    expect(after.closingCommPct?.toFixed(4)).toBe(seeded.closingCommPct?.toFixed(4));
    expect(after.companyCutPct.toFixed(4)).toBe(seeded.companyCutPct.toFixed(4));
    expect(after.effectiveDate.toISOString()).toBe(seeded.effectiveDate.toISOString());
  });
});

describe("updateProductPricing — closingBasis (2026-10-01)", () => {
  it("is part of the audit before/after, in the same transaction as the rest of pricing", async () => {
    const id = await freshProduct(TAG + "CB-AUDIT1");
    const before = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(before.closingBasis).toBe("ListedPrice"); // the DB/zod default, never sent explicitly by freshProduct

    const r = await updateProductPricing(id, {
      listedPrice: "500.00", discountedPrice: "450.00", closingBasis: "DiscountedPrice",
    });
    expect(r).toEqual({ ok: true });

    const rows = await prisma.auditLog.findMany({ where: { entityId: id, action: "product.pricing_updated" } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].beforeJson)).toContain("ListedPrice");
    expect(JSON.stringify(rows[0].afterJson)).toContain("DiscountedPrice");

    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.closingBasis).toBe("DiscountedPrice");
  });

  it("accepts DiscountedPrice when discountedPrice is set in the SAME call (a normal edit, not just a pre-existing discount)", async () => {
    const id = await freshProduct(TAG + "CB-OK1");
    const r = await updateProductPricing(id, { listedPrice: "500.00", discountedPrice: "400.00", closingBasis: "DiscountedPrice" });
    expect(r).toEqual({ ok: true });
  });

  it("rejects DiscountedPrice with no discountedPrice (invalidInput), and leaves the row untouched — the edge case named in the spec", async () => {
    const id = await freshProduct(TAG + "CB-REJECT1", { discountedPrice: "900.00" });
    const before = await prisma.product.findUniqueOrThrow({ where: { id } });

    // Clearing the discount while the basis is still DiscountedPrice — the
    // UI is expected to switch the basis back to ListedPrice itself, so this
    // models the server catching a client that didn't (or a direct caller).
    const r = await updateProductPricing(id, { listedPrice: "999.99", closingBasis: "DiscountedPrice" });
    expect(r).toEqual({ ok: false, error: "invalidInput" });

    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.discountedPrice?.toFixed(2)).toBe(before.discountedPrice?.toFixed(2));
    expect(after.closingBasis).toBe(before.closingBasis);

    // Positive control: the SAME payload, basis switched back to ListedPrice
    // (what the UI actually does), succeeds — proving the rejection above is
    // about the DiscountedPrice+no-discount combination specifically, not
    // about clearing a discount in general.
    const control = await updateProductPricing(id, { listedPrice: "999.99", closingBasis: "ListedPrice" });
    expect(control).toEqual({ ok: true });
  });
});

describe("updateProductPricing — server nulls/replaces what an empty plan list doesn't call for", () => {
  it("dropping the last plan nulls bookingFee, even if the caller sends a stale value back", async () => {
    const id = await freshProduct(TAG + "NULLOUT1", {
      bookingFee: "50.00", instalmentPlans: [{ months: 12 }],
    });
    // The caller sends a STALE bookingFee back (a real client could easily
    // still be holding it in form state after clearing every plan row) —
    // pricingRefine never forbids bookingFee when instalmentPlans is empty,
    // so this is a valid payload, not a hypothetical one.
    const r = await updateProductPricing(id, { listedPrice: "999.99", bookingFee: "50.00", instalmentPlans: [] });
    expect(r).toEqual({ ok: true });
    const row = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.bookingFee).toBeNull();
    expect(await prisma.productInstalmentPlan.count({ where: { productId: id } })).toBe(0);
  });

  it("replacing a two-plan product with one different plan leaves exactly that one plan row, not three", async () => {
    const id = await freshProduct(TAG + "REPLACE1", {
      bookingFee: "50.00", instalmentPlans: [{ months: 12 }, { months: 24 }],
    });
    const r = await updateProductPricing(id, {
      listedPrice: "999.99", bookingFee: "30.00", instalmentPlans: [{ months: 6 }],
    });
    expect(r).toEqual({ ok: true });
    // This assertion examines every plan row the product has after the edit.
    const rows = await prisma.productInstalmentPlan.findMany({ where: { productId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].months).toBe(6);
    // monthlyAmount is never written (owner's "no override allowed" ruling,
    // 2026-10-09 follow-up) — frozen, nullable, unread.
    expect(rows[0].monthlyAmount).toBeNull();
  });
});
