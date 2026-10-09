// Owner-requested product description, reusing the former Product.remarks
// column (renamed via migration — see prisma/migrations/20261006020000_
// rename_product_remarks_to_description, and its own comment for the
// zero-drift proof this isn't a DROP+ADD in disguise).
//
// T1: a product created WITH a description round-trips it through the real
// row; one created WITHOUT it is valid, with a real null column — not an
// empty string, not the key omitted from the row. Real Postgres, real
// createProduct — same convention as product-details-edit.integration.test.ts.
//
// T3: the 500-character bound is enforced SERVER-SIDE, by productSchema
// (lib/schemas.ts) inside createProduct itself — called directly here, which
// is what "client validation bypassed" means for a server action: there is
// no client in this test at all, so nothing a browser's maxLength attribute
// does is what stands between a long string and the database. A rejected
// call must also create NO row, not merely return an error.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { createProduct, updateProduct, type ProductInput } from "./actions";
import { PRODUCT_DESCRIPTION_MAX } from "@/lib/product-limits";

const TAG = "PRODDESC-";
const ADMIN = { user: { id: "22222222-2222-2222-2222-222222222222", associateId: null, role: "Admin" } };

const BASE_RATES = {
  commissionType: "Percentage" as const,
  closingCommPct: "10",
  companyCutPct: "2",
  smOverridePct: "5",
  sdOverridePct: "3",
  isExternal: false,
  effectiveDate: "2099-01-01",
};
const BASE_PRICING = { listedPrice: "999.99" };

beforeAll(() => { who.session = ADMIN; });
afterAll(async () => {
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
});

describe("product description — T1: round-trips through a real row", () => {
  it("created WITH a description: the real row holds it verbatim", async () => {
    const code = TAG + "WITH1";
    const r = await createProduct({
      productCode: code, productName: "Fake product with description", ...BASE_RATES, ...BASE_PRICING,
      description: "A short, honest description of what this product covers.",
    } as ProductInput);
    expect(r).toEqual({ ok: true });
    const row = await prisma.product.findFirstOrThrow({ where: { productCode: code } });
    expect(row.description).toBe("A short, honest description of what this product covers.");
  });

  it("created WITHOUT a description: still valid, and the column is a real null — not an empty string, not the key missing from the row", async () => {
    const code = TAG + "WITHOUT1";
    const r = await createProduct({
      productCode: code, productName: "Fake product without description", ...BASE_RATES, ...BASE_PRICING,
    } as ProductInput);
    expect(r).toEqual({ ok: true });
    const row = await prisma.product.findFirstOrThrow({ where: { productCode: code } });
    expect(row).toHaveProperty("description");
    expect(row.description).toBeNull();
    expect(row.description).not.toBe("");
  });

  it("an existing product's description round-trips through updateProduct too, and clears to null when omitted — same convention as productCategory", async () => {
    const code = TAG + "UPD1";
    const created = await createProduct({ productCode: code, productName: "X", ...BASE_RATES, ...BASE_PRICING } as ProductInput);
    expect(created).toEqual({ ok: true });
    const id = (await prisma.product.findFirstOrThrow({ where: { productCode: code } })).id;

    const withDesc = await updateProduct(id, { productName: "X", ...BASE_RATES, ...BASE_PRICING, description: "Added on edit." });
    expect(withDesc).toEqual({ ok: true });
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).description).toBe("Added on edit.");

    const cleared = await updateProduct(id, { productName: "X", ...BASE_RATES, ...BASE_PRICING });
    expect(cleared).toEqual({ ok: true });
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).description).toBeNull();
  });
});

describe("product description — T3: the 500-character bound is enforced server-side", () => {
  it(`exactly ${PRODUCT_DESCRIPTION_MAX} characters is accepted (the boundary itself, not just 'a long string')`, async () => {
    const code = TAG + "BOUND-OK";
    const exactly500 = "x".repeat(PRODUCT_DESCRIPTION_MAX);
    expect(exactly500).toHaveLength(500);
    const r = await createProduct({
      productCode: code, productName: "Fake boundary product", ...BASE_RATES, ...BASE_PRICING, description: exactly500,
    } as ProductInput);
    expect(r).toEqual({ ok: true });
    const row = await prisma.product.findFirstOrThrow({ where: { productCode: code } });
    expect(row.description).toHaveLength(500);
  });

  it(`${PRODUCT_DESCRIPTION_MAX + 1} characters is REJECTED server-side, with no row created at all — called directly, which is what "client validation bypassed" means here: there is no client in this test`, async () => {
    const code = TAG + "BOUND-REJECT";
    const tooLong = "x".repeat(PRODUCT_DESCRIPTION_MAX + 1);
    expect(tooLong).toHaveLength(501);
    const r = await createProduct({
      productCode: code, productName: "Fake over-limit product", ...BASE_RATES, ...BASE_PRICING, description: tooLong,
    } as ProductInput);
    expect(r).toEqual({ ok: false, error: "invalidInput" });
    const count = await prisma.product.count({ where: { productCode: code } });
    expect(count).toBe(0);
  });

  it("the same bound applies on updateProduct, not just createProduct — an existing row survives a rejected over-limit edit unchanged", async () => {
    const code = TAG + "BOUND-UPD";
    await createProduct({ productCode: code, productName: "X", ...BASE_RATES, ...BASE_PRICING, description: "fine" } as ProductInput);
    const id = (await prisma.product.findFirstOrThrow({ where: { productCode: code } })).id;
    const r = await updateProduct(id, { productName: "X", ...BASE_RATES, ...BASE_PRICING, description: "x".repeat(PRODUCT_DESCRIPTION_MAX + 1) });
    expect(r).toEqual({ ok: false, error: "invalidInput" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).description).toBe("fine");
  });
});
