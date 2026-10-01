// Portal catalogue (2026-10-01): proves commission-adjacent fields the
// company or an upline keeps — never the closing commission the ASSOCIATE
// is told about — are SELECTED OUT of the portal's product read, not merely
// unused by the mapping step. Tests the raw prisma rows (fetchPortalProductRows),
// not getPortalProductCatalogue's hand-built output — the mapped shape can
// never carry an extra key regardless of what the select fetches (it only
// ever assigns named fields), so asserting on it would make every control
// below permanently vacuous.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { fetchPortalProductRows, PORTAL_PRODUCT_SELECT } from "./portal-catalogue";

const TAG = "PORTALCAT-";
const COMPANY_PREFIX = "PORTALCATTEST";

// The full class of "the company's or an upline's share" fields on Product —
// every one of these must be both ABSENT from a real row and OUTSIDE the
// select's own declared key set. Each gets a distinctive non-default value
// below so a leak into the result is unmistakable (not confusable with a
// column default a real product might also happen to carry).
const COMPANY_SHARE_FIELDS = [
  "companyCutPct",
  "companyCutType",
  "asmOverridePct",
  "smOverridePct",
  "smOverrideType",
  "sdOverridePct",
  "sdOverrideType",
  "companyRetainedPct",
  "externalCompanyRetainedPct",
] as const;

// The complete, explicit allow-list for the portal's own select — equality,
// not a subset check, so adding ANY new field (company-share or otherwise)
// without updating this list fails the test rather than passing silently.
const ALLOWED_TOP_LEVEL_KEYS = [
  "id",
  "productCode",
  "productName",
  "productCategory",
  "activeStatus",
  "listedPrice",
  "discountedPrice",
  "closingBasis",
  "instalmentOption",
  "bookingFee",
  "monthlyInstalment12",
  "monthlyInstalment24",
  "commissionType",
  "closingCommPct",
  "closingCommFixed",
  "defaultCompany",
].sort();

let companyId = "";

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: "Fake portal-catalogue company", invoicePrefix: COMPANY_PREFIX },
  });
  companyId = company.id;

  await prisma.product.create({
    data: {
      productCode: TAG + "1",
      productName: "Fake portal-catalogue product",
      commissionType: "Percentage",
      closingCommPct: "10",
      companyCutPct: "51",
      companyCutType: "Percentage",
      asmOverridePct: "54",
      smOverridePct: "52",
      smOverrideType: "Percentage",
      sdOverridePct: "53",
      sdOverrideType: "Percentage",
      companyRetainedPct: "55",
      isExternal: true,
      externalCompanyRetainedPct: "56", // distinctive — must not surface anywhere below
      defaultCompanyId: companyId,
      effectiveDate: new Date("2099-01-01"),
      activeStatus: "Active",
      listedPrice: "500.00",
      instalmentOption: "None",
    },
  });
});
afterAll(async () => {
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { invoicePrefix: COMPANY_PREFIX } });
});

describe("portal catalogue — the whole company/upline-share CLASS is selected out, not just company cut", () => {
  it("the select's own key set equals the explicit allow-list — exactly, not a subset", () => {
    expect(Object.keys(PORTAL_PRODUCT_SELECT).sort()).toEqual(ALLOWED_TOP_LEVEL_KEYS);
  });

  it("a REAL RETURNED ROW's key set equals the same allow-list (the declaration could drift from what prisma actually returns)", async () => {
    const rows = await fetchPortalProductRows();
    const row = rows.find((r) => r.productCode === TAG + "1");
    expect(row).toBeDefined();
    expect(Object.keys(row as object).sort()).toEqual(ALLOWED_TOP_LEVEL_KEYS);
  });

  it("RECURSIVE — the nested defaultCompany carries ONLY name, not the rest of Company", async () => {
    const rows = await fetchPortalProductRows();
    const row = rows.find((r) => r.productCode === TAG + "1");
    expect(row?.defaultCompany).toBeDefined();
    expect(Object.keys(row?.defaultCompany as object).sort()).toEqual(["name"]);
  });

  it.each(COMPANY_SHARE_FIELDS)("%s specifically is absent from the returned row", async (field) => {
    const rows = await fetchPortalProductRows();
    const row = rows.find((r) => r.productCode === TAG + "1");
    expect(row).not.toHaveProperty(field);
  });

  it("sanity: the row is real and non-empty, not a vacuous pass from an empty/missing result", async () => {
    const rows = await fetchPortalProductRows();
    const row = rows.find((r) => r.productCode === TAG + "1");
    expect(row?.listedPrice?.toFixed(2)).toBe("500.00");
  });

  it("CONTROL — the key-set equality fails once the select is widened to include a company-share field", async () => {
    const widenedRows = await prisma.product.findMany({
      where: { productCode: TAG + "1" },
      select: { ...PORTAL_PRODUCT_SELECT, companyCutPct: true, externalCompanyRetainedPct: true },
    });
    const widened = widenedRows[0];
    // Same shape of assertion as the real test above, against a select that
    // DOES carry two company-share fields — it must NOT equal the allow-list
    // here, proving the equality check above would have failed had the real
    // select leaked either field. A control that can't be violated is decoration.
    expect(Object.keys(widened).sort()).not.toEqual(ALLOWED_TOP_LEVEL_KEYS);
    expect(widened).toHaveProperty("companyCutPct");
    expect(widened.companyCutPct?.toFixed(4)).toBe("51.0000");
    expect(widened).toHaveProperty("externalCompanyRetainedPct");
    expect(widened.externalCompanyRetainedPct?.toFixed(4)).toBe("56.0000");
  });

  it("CONTROL — the recursive defaultCompany check fails once that relation is widened to the whole row", async () => {
    const widenedRows = await prisma.product.findMany({
      where: { productCode: TAG + "1" },
      select: { ...PORTAL_PRODUCT_SELECT, defaultCompany: true },
    });
    const widened = widenedRows[0];
    // defaultCompany: true pulls the WHOLE Company row (invoicePrefix,
    // gstRate, stampFileKey, ...) — the top-level key set is unchanged (still
    // just "defaultCompany"), which is exactly why a non-recursive check
    // would miss this. The nested key set must now differ from ["name"].
    expect(Object.keys(widened.defaultCompany as object).sort()).not.toEqual(["name"]);
    expect(widened.defaultCompany).toHaveProperty("invoicePrefix");
  });
});
