// Owner's change (2026-10-09): instalments are a repeatable add-on list.
// CASE (i): a product with two plans (12 and 24 months) exposes BOTH, on
// every surface that reads them. CASE (ii): a product with none exposes
// full payment only — there is no "FullPayment" row anywhere to find,
// because there is nothing to create for it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const who: { session: unknown } = { session: null };
import { vi } from "vitest";
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { createProduct, type ProductInput } from "./actions";
import { getPortalProductCatalogue } from "./portal-catalogue";

const TAG = "INSTPLAN-";
const ADMIN = { user: { id: "55555555-5555-5555-5555-555555555555", associateId: null, role: "Admin" } };
const BASE_RATES = {
  commissionType: "Percentage" as const, closingCommPct: "10", companyCutPct: "2",
  smOverridePct: "5", sdOverridePct: "3", isExternal: false, effectiveDate: "2099-01-01",
};

let twoPlansId = "", noPlansId = "";

beforeAll(async () => {
  who.session = ADMIN;
  const withTwo = await createProduct({
    productCode: TAG + "TWO", productName: "Fake two-plan product", ...BASE_RATES,
    listedPrice: "1200.00", bookingFee: "50.00",
    instalmentPlans: [{ months: 12, monthlyAmount: "95.83" }, { months: 24, monthlyAmount: "47.92" }],
  } as ProductInput);
  expect(withTwo).toEqual({ ok: true });
  twoPlansId = (await prisma.product.findFirstOrThrow({ where: { productCode: TAG + "TWO" } })).id;

  const withNone = await createProduct({
    productCode: TAG + "NONE", productName: "Fake no-plan product", ...BASE_RATES,
    listedPrice: "999.00",
  } as ProductInput);
  expect(withNone).toEqual({ ok: true });
  noPlansId = (await prisma.product.findFirstOrThrow({ where: { productCode: TAG + "NONE" } })).id;
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
});

describe("CASE (i) — a product with two plans exposes BOTH", () => {
  it("the raw DB table has exactly 2 rows for this product, 12 and 24 months", async () => {
    const rows = await prisma.productInstalmentPlan.findMany({ where: { productId: twoPlansId }, orderBy: { months: "asc" } });
    // This assertion examines every plan row this product actually has.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.months)).toEqual([12, 24]);
    expect(rows[0].monthlyAmount?.toFixed(2)).toBe("95.83");
    expect(rows[1].monthlyAmount?.toFixed(2)).toBe("47.92");
  });

  it("the portal catalogue exposes both plans, sorted, to the buyer-facing surface", async () => {
    const catalogue = await getPortalProductCatalogue();
    const p = catalogue.find((c) => c.id === twoPlansId);
    expect(p).toBeDefined();
    expect(p?.instalmentPlans).toEqual([
      { months: 12, monthlyAmount: "95.83" },
      { months: 24, monthlyAmount: "47.92" },
    ]);
    expect(p?.bookingFee).toBe("50.00");
  });
});

describe("CASE (ii) — a product with no plans exposes full payment only", () => {
  it("the raw DB table has ZERO rows for this product — full payment is the absence of a row, never a row of its own", async () => {
    expect(await prisma.productInstalmentPlan.count({ where: { productId: noPlansId } })).toBe(0);
  });

  it("the portal catalogue shows an empty instalmentPlans list and a null bookingFee", async () => {
    const catalogue = await getPortalProductCatalogue();
    const p = catalogue.find((c) => c.id === noPlansId);
    expect(p).toBeDefined();
    expect(p?.instalmentPlans).toEqual([]);
    expect(p?.bookingFee).toBeNull();
  });

  it("CONTROL — the two-plan product's rows are not somehow this product's rows (ids are genuinely distinct)", async () => {
    expect(twoPlansId).not.toBe(noPlansId);
    const crossCheck = await prisma.productInstalmentPlan.count({ where: { productId: noPlansId, months: { in: [12, 24] } } });
    expect(crossCheck).toBe(0);
  });
});
