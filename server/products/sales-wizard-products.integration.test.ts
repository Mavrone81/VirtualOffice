// Sales wizard products (2026-10-01): proves the new/edit sale pages read
// ONLY what FormProduct needs — never commission, company cut, pricing, or
// any other Product column — via an explicit select, checked by equality
// against an allow-list on the REAL RETURNED rows (not the select
// declaration, which could drift from what prisma actually returns), and
// recursively into both nested shapes (defaultCompany, and each comCodes
// entry). Mirrors portal-catalogue.integration.test.ts's method.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { fetchActiveSalesWizardProducts, SALES_WIZARD_PRODUCT_SELECT } from "./sales-wizard-products";

const TAG = "SALESWIZPROD-";
const COMPANY_PREFIX = "SALESWIZPRODTEST";

const ALLOWED_TOP_LEVEL_KEYS = ["id", "productCode", "productName", "requiresAshesAgreement", "comCodes", "defaultCompany"].sort();
const ALLOWED_COMCODE_KEYS = ["id", "comCode", "label", "valueType", "value"].sort();

let companyId = "";

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: "Fake sales-wizard company", invoicePrefix: COMPANY_PREFIX },
  });
  companyId = company.id;

  await prisma.product.create({
    data: {
      productCode: TAG + "1",
      productName: "Fake sales-wizard product",
      commissionType: "Percentage",
      closingCommPct: "10",
      companyCutPct: "61", // distinctive — must not surface anywhere below
      smOverridePct: "62",
      sdOverridePct: "63",
      isExternal: false,
      defaultCompanyId: companyId,
      effectiveDate: new Date("2099-01-01"),
      activeStatus: "Active",
      listedPrice: "500.00",
      instalmentOption: "None",
      comCodes: {
        create: [{ comCode: TAG + "CC1", label: "Fake add-on", valueType: "Percentage", value: "2", active: true }],
      },
    },
  });
});
afterAll(async () => {
  await prisma.comcode.deleteMany({ where: { comCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { invoicePrefix: COMPANY_PREFIX } });
});

describe("sales wizard products — explicit select, proved on returned rows", () => {
  it("the select's own key set equals the explicit allow-list — exactly, not a subset", () => {
    expect(Object.keys(SALES_WIZARD_PRODUCT_SELECT).sort()).toEqual(ALLOWED_TOP_LEVEL_KEYS);
  });

  it("a REAL RETURNED ROW's key set equals the same allow-list", async () => {
    const rows = await fetchActiveSalesWizardProducts();
    const row = rows.find((r) => r.productCode === TAG + "1");
    expect(row).toBeDefined();
    expect(Object.keys(row as object).sort()).toEqual(ALLOWED_TOP_LEVEL_KEYS);
  });

  it("RECURSIVE — the nested defaultCompany carries ONLY name", async () => {
    const rows = await fetchActiveSalesWizardProducts();
    const row = rows.find((r) => r.productCode === TAG + "1");
    expect(row?.defaultCompany).toBeDefined();
    expect(Object.keys(row?.defaultCompany as object).sort()).toEqual(["name"]);
  });

  it("RECURSIVE — each comCodes entry carries exactly id/comCode/label/valueType/value, nothing else", async () => {
    const rows = await fetchActiveSalesWizardProducts();
    const row = rows.find((r) => r.productCode === TAG + "1");
    expect(row?.comCodes.length).toBeGreaterThan(0);
    for (const c of row?.comCodes ?? []) {
      expect(Object.keys(c).sort()).toEqual(ALLOWED_COMCODE_KEYS);
    }
  });

  it("sanity: the row is real, not a vacuous pass from an empty/missing result", async () => {
    const rows = await fetchActiveSalesWizardProducts();
    const row = rows.find((r) => r.productCode === TAG + "1");
    expect(row?.productName).toBe("Fake sales-wizard product");
  });

  it("CONTROL — the top-level key-set equality fails once the select is widened to include a commission field", async () => {
    const widenedRows = await prisma.product.findMany({
      where: { productCode: TAG + "1" },
      select: { ...SALES_WIZARD_PRODUCT_SELECT, companyCutPct: true },
    });
    const widened = widenedRows[0];
    expect(Object.keys(widened).sort()).not.toEqual(ALLOWED_TOP_LEVEL_KEYS);
    expect(widened).toHaveProperty("companyCutPct");
    expect(widened.companyCutPct?.toFixed(4)).toBe("61.0000");
  });

  it("CONTROL — the recursive defaultCompany check fails once that relation is widened to the whole row", async () => {
    const widenedRows = await prisma.product.findMany({
      where: { productCode: TAG + "1" },
      select: { ...SALES_WIZARD_PRODUCT_SELECT, defaultCompany: true },
    });
    const widened = widenedRows[0];
    expect(Object.keys(widened.defaultCompany as object).sort()).not.toEqual(["name"]);
    expect(widened.defaultCompany).toHaveProperty("invoicePrefix");
  });

  it("CONTROL — the recursive comCodes check fails once that select is widened to include an extra field", async () => {
    const widenedRows = await prisma.product.findMany({
      where: { productCode: TAG + "1" },
      select: {
        ...SALES_WIZARD_PRODUCT_SELECT,
        comCodes: { where: { active: true }, select: { id: true, comCode: true, label: true, valueType: true, value: true, active: true } },
      },
    });
    const widened = widenedRows[0];
    expect(widened.comCodes.length).toBeGreaterThan(0);
    for (const c of widened.comCodes) {
      expect(Object.keys(c).sort()).not.toEqual(ALLOWED_COMCODE_KEYS);
      expect(c).toHaveProperty("active");
    }
  });
});
