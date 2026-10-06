// Owner-requested product description — T2/T4. A projection can carry a
// field no component displays, and a test on the query's return value would
// pass against an unchanged screen; every assertion below is on RENDERED
// OUTPUT. No DOM library in this repo (see server/products/
// product-edit-ui-reachability.test.ts, the existing precedent for exactly
// this technique): client components are rendered with react-dom/server;
// the two async server pages are called directly and their returned element
// rendered the same way. Real auth/db mocked; nothing else.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";

// Prisma Decimal columns read back as Decimals; stored strings need the same shape.
const dec = (v: string) => new Prisma.Decimal(v);

const who: { session: unknown } = { session: null };
const { fakeProduct } = vi.hoisted(() => ({
  fakeProduct: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("@/lib/env", () => ({ env: { A17_CLOSED_DEAL_FLOW: false } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "en" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useTransition: () => [false, (fn: () => Promise<unknown>) => { void fn(); }],
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    product: fakeProduct,
    company: { findMany: vi.fn(async () => []) },
    commissionStructureVersion: { findMany: vi.fn(async () => []) },
  },
}));

import ProductsPage from "@/app/admin/products/page";
import EditProductPage from "@/app/admin/products/[id]/edit/page";
import { ProductForm } from "@/app/admin/products/new/product-form";
import { EditProductForm } from "@/app/admin/products/[id]/edit/edit-product-form";
import { ProductCard } from "@/app/portal/products/product-card";
import type { Translator } from "@/app/portal/products/commission-cut";
import type { PortalCatalogueProduct } from "@/server/products/portal-catalogue";
import type { PricingValue } from "@/app/admin/products/pricing-card";
import type { CommissionValue } from "@/app/admin/products/commission-card";

const ADMIN = { user: { id: "22222222-2222-2222-2222-222222222222", associateId: null, role: "Admin" } };
const PRODUCT_ID = "11111111-1111-1111-1111-111111111111";

// Neutral fixture — no real person, no owner name.
const DESCRIPTION = "Covers the standard package end to end.";

const row: Record<string, unknown> = {
  id: PRODUCT_ID, productCode: "FUN-BASE", productName: "Basic Funeral Package", productCategory: "Funeral",
  description: null as string | null,
  defaultCompanyId: null, commissionType: "Percentage", closingCommPct: dec("10"), closingCommFixed: null,
  companyCutPct: dec("2"), companyCutType: "Percentage", smOverridePct: dec("5"), smOverrideType: "Percentage",
  sdOverridePct: dec("3"), sdOverrideType: "Percentage", isExternal: false, externalCompanyRetainedPct: null,
  effectiveDate: new Date("2099-01-01"), activeStatus: "Active", requiresAshesAgreement: false, requiredDocuments: [],
  comCodes: [], defaultCompany: null,
  listedPrice: dec("999.99"), discountedPrice: null, closingBasis: "ListedPrice", instalmentOption: "None",
  bookingFee: null, monthlyInstalment12: null, monthlyInstalment24: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  who.session = ADMIN;
  Object.assign(fakeProduct, {
    findMany: vi.fn(async () => [{ ...row }]),
    findUnique: vi.fn(async () => ({ ...row })),
  });
});

async function renderAdminList(): Promise<string> {
  return renderToStaticMarkup((await ProductsPage()) as ReactElement);
}
async function renderEditPage(): Promise<string> {
  const el = (await EditProductPage({ params: Promise.resolve({ id: PRODUCT_ID }) })) as ReactElement;
  return renderToStaticMarkup(el);
}

const EMPTY_PRICING: PricingValue = { listedPrice: "", discountedPrice: "", closingBasis: "ListedPrice", instalmentOption: "None", bookingFee: "", monthlyInstalment12: "", monthlyInstalment24: "" };
const EMPTY_COMMISSION: CommissionValue = {
  commissionType: "Percentage", closingCommPct: "10", closingCommFixed: undefined,
  companyCutPct: "2", companyCutType: "Percentage", smOverridePct: "5", smOverrideType: "Percentage",
  sdOverridePct: "3", sdOverrideType: "Percentage", isExternal: false, externalCompanyRetainedPct: undefined,
  effectiveDate: "2099-01-01",
};
function renderEditForm(description: string): string {
  return renderToStaticMarkup(h(EditProductForm, {
    productId: PRODUCT_ID, companies: [],
    initial: { productName: "Basic Funeral Package", productCategory: "Funeral", description, defaultCompanyId: "", pricing: EMPTY_PRICING, commission: EMPTY_COMMISSION },
    earliestEffectiveDate: "2099-01-01",
  }));
}
function renderCreateForm(): string {
  return renderToStaticMarkup(h(ProductForm, { companies: [], today: "2099-01-01" }));
}
function fakeTranslator(): Translator {
  const t = ((key: string) => key) as Translator;
  t.rich = (key: string) => key;
  return t;
}

function renderPortalCard(description: string | null): string {
  const p: PortalCatalogueProduct = {
    id: PRODUCT_ID, productCode: "FUN-BASE", productName: "Basic Funeral Package", productCategory: "Funeral",
    description, companyName: "Enshrine", activeStatus: "Active", listedPrice: "999.99", discountedPrice: null,
    closingBasis: "ListedPrice", instalmentOption: "None", bookingFee: null, monthlyInstalment12: null, monthlyInstalment24: null,
    commissionType: "Percentage", closingCommPct: "10.0000", closingCommFixed: null,
  };
  return renderToStaticMarkup(h(ProductCard, { p, t: fakeTranslator(), tc: (k: string) => k }));
}

describe("product description reaches every surface (T2) — set", () => {
  it("admin list: a product WITH a description shows it on the rendered list row", async () => {
    fakeProduct.findMany = vi.fn(async () => [{ ...row, description: DESCRIPTION }]);
    const html = await renderAdminList();
    expect(html).toContain(DESCRIPTION);
  });

  it("edit form: the textarea's initial value carries the description fetched from the real row", async () => {
    fakeProduct.findUnique = vi.fn(async () => ({ ...row, description: DESCRIPTION }));
    const html = await renderEditPage();
    expect(html).toContain(`id="desc"`);
    expect(html).toContain(DESCRIPTION);
  });

  it("portal card: a row WITH a description shows it under the category line", () => {
    const html = renderPortalCard(DESCRIPTION);
    expect(html).toContain(DESCRIPTION);
    expect(html).toContain("line-clamp-2"); // the visual clamp, not just presence
  });

  it("create form: the description textarea and its character counter exist on the fresh-form surface", () => {
    const html = renderCreateForm();
    expect(html).toContain(`id="desc"`);
    expect(html).toContain("0/500"); // empty initial state, counter present
  });
});

describe("product description reaches every surface (T4) — null renders without error", () => {
  it("admin list: a product with NO description renders with no error and no stray clamp element", async () => {
    fakeProduct.findMany = vi.fn(async () => [{ ...row, description: null }]);
    const html = await renderAdminList();
    expect(html).not.toContain("line-clamp-2");
  });

  it("edit form: a null-description row renders the textarea empty, not literally 'null'", async () => {
    fakeProduct.findUnique = vi.fn(async () => ({ ...row, description: null }));
    const html = await renderEditPage();
    expect(html).toContain(`id="desc"`);
    expect(html).not.toContain(">null<");
  });

  it("portal card: a row with description: null renders with no error and no stray clamp element", () => {
    expect(() => renderPortalCard(null)).not.toThrow();
    const html = renderPortalCard(null);
    expect(html).not.toContain("line-clamp-2");
  });

  it("edit form, rendered directly with description: '' (the form component's own prop contract — EditProductInitial.description is a plain string, same as productCategory): no error, empty textarea", () => {
    expect(() => renderEditForm("")).not.toThrow();
    const html = renderEditForm("");
    expect(html).toContain(`id="desc"`);
  });
});
