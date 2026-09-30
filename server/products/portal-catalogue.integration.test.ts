// Portal catalogue (2026-09-30): proves company cut is SELECTED OUT of the
// portal's product read, not merely unused by the mapping step. Tests the
// raw prisma rows (fetchPortalProductRows), not getPortalProductCatalogue's
// hand-built output — the mapped shape below can never carry an extra key
// regardless of what the select fetches (it only ever assigns named fields),
// so asserting on it would make the control below permanently vacuous.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { fetchPortalProductRows, PORTAL_PRODUCT_SELECT } from "./portal-catalogue";

const TAG = "PORTALCAT-";

beforeAll(async () => {
  await prisma.product.create({
    data: {
      productCode: TAG + "1",
      productName: "Fake portal-catalogue product",
      commissionType: "Percentage",
      closingCommPct: "10",
      companyCutPct: "37", // distinctive, non-default — must not surface anywhere below
      smOverridePct: "5",
      sdOverridePct: "3",
      isExternal: false,
      effectiveDate: new Date("2099-01-01"),
      activeStatus: "Active",
      listedPrice: "500.00",
      instalmentOption: "None",
    },
  });
});
afterAll(async () => {
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
});

describe("portal catalogue — company cut is selected out, not just unused", () => {
  it("the real portal select's rows carry no company-cut key at all", async () => {
    const rows = await fetchPortalProductRows();
    const row = rows.find((r) => r.productCode === TAG + "1");
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("companyCutPct");
    expect(row).not.toHaveProperty("companyCutType");
    // Sanity: the row is real and non-empty, not a vacuous pass from an
    // empty/missing result (the standing "assert non-empty" rule).
    expect(row?.listedPrice?.toFixed(2)).toBe("500.00");
  });

  it("CONTROL — the identical assertion fails once the select is widened to include companyCutPct", async () => {
    const widenedRows = await prisma.product.findMany({
      where: { productCode: TAG + "1" },
      select: { ...PORTAL_PRODUCT_SELECT, companyCutPct: true, companyCutType: true },
    });
    const widened = widenedRows[0];
    expect(widened).toBeDefined();
    // This is the same shape of assertion as the test above, run against a
    // select that DOES include company cut — it must come out true here,
    // proving the "not.toHaveProperty" above would have failed had the real
    // select leaked the field. A control that can't be violated is decoration.
    expect(widened).toHaveProperty("companyCutPct");
    expect(widened).toHaveProperty("companyCutType");
    expect(widened.companyCutPct?.toFixed(4)).toBe("37.0000");
  });
});
