// A future-dated rate change must not show before it takes effect. The product
// row mirrors the LATEST version, so every display reader resolves the version
// in force today instead (server/products/current-rates.ts). Real Postgres; the
// change is made through updateProduct, the way the UI makes it. Fake data only.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { createProduct, updateProduct, type ProductInput } from "./actions";
import type { ProductDetailsRawInput } from "@/lib/schemas";
import { fetchPortalProductRows, getPortalProductCatalogue } from "./portal-catalogue";
import { withCurrentRates, loadPendingRateChanges } from "./current-rates";
import { computeProductBreakdown } from "@/server/commission/product-breakdown";

const TAG = "CURRATE-";
const CODE = TAG + "P1";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const D = (s: string) => new Date(s + "T12:00:00");
const V1 = "2098-01-01", V2 = "2098-06-01";
const RATES = { commissionType: "Percentage" as const, companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3", isExternal: false };
const PRICING = { listedPrice: "10000.00", instalmentOption: "None" as const };
let id = "", companyId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  who.session = ADMIN;
  expect(await createProduct({ productCode: CODE, productName: "Current rate", defaultCompanyId: companyId, ...RATES, closingCommPct: "10", effectiveDate: V1, ...PRICING } as ProductInput)).toEqual({ ok: true });
  id = (await prisma.product.findFirstOrThrow({ where: { productCode: CODE } })).id;
  const edit = (closing: string, eff: string) =>
    updateProduct(id, { productName: "Current rate", defaultCompanyId: companyId, ...RATES, closingCommPct: closing, effectiveDate: eff, ...PRICING } as ProductDetailsRawInput);
  expect(await edit("20", V2)).toEqual({ ok: true });
  expect(await edit("25", V2)).toEqual({ ok: true }); // same-day correction of the future change
});
afterAll(async () => {
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

const mine = <T extends { productCode: string }>(rows: T[]) => rows.filter((r) => r.productCode === CODE);

describe("fixture: what is stored", () => {
  it("3 versions (10% at V1; 20% and a same-day 25% correction at V2); the product row MIRRORS the latest, i.e. the future one", async () => {
    expect(await prisma.commissionStructureVersion.count({ where: { productCode: CODE } })).toBe(3);
    const row = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(row.closingCommPct?.toFixed(4)).toBe("25.0000");
    expect(row.effectiveDate.toISOString().slice(0, 10)).toBe(V2);
  });
});

describe("display readers show the rates IN FORCE, and the future ones only once their date arrives", () => {
  it("portal catalogue rows: before V2 → 10%; the day before V2 → 10%; on V2 → 25% (the newest same-day version)", async () => {
    for (const [now, expected] of [[D("2098-03-01"), "10.0000"], [D("2098-05-31"), "10.0000"], [D(V2), "25.0000"], [D("2099-01-01"), "25.0000"]] as const) {
      const rows = mine(await fetchPortalProductRows(now));
      expect(rows).toHaveLength(1); // exactly one catalogue row for the product
      expect(rows[0].closingCommPct?.toFixed(4)).toBe(expected);
    }
  });

  it("portal catalogue cards (what an associate reads) carry the same figure", async () => {
    expect(mine(await getPortalProductCatalogue(D("2098-03-01")))[0].closingCommPct).toBe("10.0000");
    expect(mine(await getPortalProductCatalogue(D(V2)))[0].closingCommPct).toBe("25.0000");
  });

  it("the portal select stays narrow: the overlay adds no company-cut or retained-% key", async () => {
    const row = mine(await fetchPortalProductRows(D(V2)))[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty("companyCutPct");
    expect(row).not.toHaveProperty("externalCompanyRetainedPct");
  });

  it("admin list / commission page rows (full product rows): rates, type and effective date are those in force", async () => {
    const all = await prisma.product.findMany({ where: { productCode: CODE } });
    expect(all).toHaveLength(1);
    const before = (await withCurrentRates(all, D("2098-03-01")))[0];
    expect(before.closingCommPct?.toFixed(4)).toBe("10.0000");
    expect(before.effectiveDate.toISOString().slice(0, 10)).toBe(V1);
    const after = (await withCurrentRates(all, D(V2)))[0];
    expect(after.closingCommPct?.toFixed(4)).toBe("25.0000");
    expect(after.effectiveDate.toISOString().slice(0, 10)).toBe(V2);
  });

  it("the admin breakdown computed from those rows moves with the date (net to closer 10%-2% = 8%, then 25%-2% = 23%)", async () => {
    const all = await prisma.product.findMany({ where: { productCode: CODE } });
    const row = (rows: typeof all) => computeProductBreakdown(rows[0]);
    expect(row(await withCurrentRates(all, D("2098-03-01")))).toMatchObject({ kind: "uniform", netToCloser: "8%" });
    expect(row(await withCurrentRates(all, D(V2)))).toMatchObject({ kind: "uniform", netToCloser: "23%" });
  });

  it("a product with NO version in force yet keeps its own columns (nothing earlier to show)", async () => {
    const all = await prisma.product.findMany({ where: { productCode: CODE } });
    const early = await withCurrentRates(all, D("2097-01-01")); // before V1
    expect(early[0].closingCommPct?.toFixed(4)).toBe("25.0000");
  });

  it("pending-change marker data: the next scheduled date per product — present before V2, gone once it arrives", async () => {
    // 1 product, 3 versions; relative to 2098-03-01 two are in the future (20% and the 25% correction) but the product gets ONE entry, dated V2
    for (const now of [D("2098-03-01"), D("2098-05-31")]) {
      const pending = await loadPendingRateChanges([CODE], now);
      expect(pending.size).toBe(1);
      expect(pending.get(CODE)!.toISOString().slice(0, 10)).toBe(V2);
    }
    expect((await loadPendingRateChanges([CODE], D(V2))).size).toBe(0);
    expect((await loadPendingRateChanges([CODE], D("2099-01-01"))).size).toBe(0);
  });
});
