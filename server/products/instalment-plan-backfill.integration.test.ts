// Proves prisma/migrations/20261009060000_product_instalment_plans's backfill
// against a row in each of the three old shapes (None / Months12 /
// Months12or24), seeded RAW (bypassing createProduct/pricingData, which never
// write instalmentOption any more) so the fixture is the actual pre-migration
// shape, not a shape this code's own write path would reproduce.
//
// The INSERT statements below are copied from that migration file rather than
// read from it, so this test exercises the exact SQL the migration runs — if
// the migration file changes, this copy has to be updated too (a drift this
// test is deliberately duplicating, not delegating).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";

const TAG = "BACKFILL-";
let noneId = "", m12Id = "", m1224Id = "";

const BACKFILL_12 = `
  INSERT INTO "product_instalment_plans" ("id", "product_id", "months", "monthly_amount", "created_at", "updated_at")
  SELECT gen_random_uuid(), "id", 12, "monthly_instalment_12", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "products"
  WHERE "instalment_option" IN ('Months12', 'Months12or24') AND "id" = ANY($1::uuid[])
  ON CONFLICT ("product_id", "months") DO NOTHING;
`;
const BACKFILL_24 = `
  INSERT INTO "product_instalment_plans" ("id", "product_id", "months", "monthly_amount", "created_at", "updated_at")
  SELECT gen_random_uuid(), "id", 24, "monthly_instalment_24", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "products"
  WHERE "instalment_option" = 'Months12or24' AND "id" = ANY($1::uuid[])
  ON CONFLICT ("product_id", "months") DO NOTHING;
`;
// Scoped to this fixture's own ids ($1) only, so this test never touches any
// other product's rows regardless of what else exists in the database --
// the migration itself has no such scope (it runs over every live row), the
// scope here is purely so this test is isolated.

async function runBackfill(ids: string[]) {
  await prisma.$executeRawUnsafe(BACKFILL_12, ids);
  await prisma.$executeRawUnsafe(BACKFILL_24, ids);
}

beforeAll(async () => {
  noneId = (await prisma.product.create({
    data: {
      productCode: TAG + "NONE", productName: "Fake legacy None", commissionType: "Percentage",
      companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3", isExternal: false,
      effectiveDate: new Date("2099-01-01"), listedPrice: "500.00", instalmentOption: "None",
    },
  })).id;
  m12Id = (await prisma.product.create({
    data: {
      productCode: TAG + "M12", productName: "Fake legacy Months12", commissionType: "Percentage",
      companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3", isExternal: false,
      effectiveDate: new Date("2099-01-01"), listedPrice: "500.00", instalmentOption: "Months12",
      bookingFee: "50.00", monthlyInstalment12: "41.66",
    },
  })).id;
  m1224Id = (await prisma.product.create({
    data: {
      productCode: TAG + "M1224", productName: "Fake legacy Months12or24", commissionType: "Percentage",
      companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3", isExternal: false,
      effectiveDate: new Date("2099-01-01"), listedPrice: "500.00", instalmentOption: "Months12or24",
      bookingFee: "30.00", monthlyInstalment12: "20.83", monthlyInstalment24: "10.42",
    },
  })).id;
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
});

describe("the fixture starts in the genuine pre-migration state", () => {
  it("CONTROL — before the backfill runs, these three rows have ZERO plan rows between them", async () => {
    const count = await prisma.productInstalmentPlan.count({ where: { productId: { in: [noneId, m12Id, m1224Id] } } });
    expect(count).toBe(0);
  });
});

describe("the backfill — run once, against all three old shapes at once", () => {
  beforeAll(async () => { await runBackfill([noneId, m12Id, m1224Id]); });

  it("None -> no rows (full payment only, nothing to insert)", async () => {
    expect(await prisma.productInstalmentPlan.count({ where: { productId: noneId } })).toBe(0);
  });

  it("Months12 -> exactly one row: months=12, monthlyAmount=monthly_instalment_12", async () => {
    const rows = await prisma.productInstalmentPlan.findMany({ where: { productId: m12Id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].months).toBe(12);
    expect(rows[0].monthlyAmount?.toFixed(2)).toBe("41.66");
  });

  it("Months12or24 -> exactly two rows: 12 (monthly_instalment_12) and 24 (monthly_instalment_24)", async () => {
    const rows = await prisma.productInstalmentPlan.findMany({ where: { productId: m1224Id }, orderBy: { months: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].months).toBe(12);
    expect(rows[0].monthlyAmount?.toFixed(2)).toBe("20.83");
    expect(rows[1].months).toBe(24);
    expect(rows[1].monthlyAmount?.toFixed(2)).toBe("10.42");
  });

  it("TOTAL row count across the three old shapes: 0 + 1 + 2 = 3, examined row by row above, not just summed", async () => {
    const total = await prisma.productInstalmentPlan.count({ where: { productId: { in: [noneId, m12Id, m1224Id] } } });
    expect(total).toBe(3);
  });

  it("re-running the backfill is a no-op (ON CONFLICT DO NOTHING) — still exactly 3 rows, not 6", async () => {
    await runBackfill([noneId, m12Id, m1224Id]);
    const total = await prisma.productInstalmentPlan.count({ where: { productId: { in: [noneId, m12Id, m1224Id] } } });
    expect(total).toBe(3);
  });
});
