// The product-details edit action (updateProduct) existed, complete, with no
// screen that called it. A test that calls updateProduct directly would have
// passed throughout, so this one starts at the screens: the products list must
// link to the edit page, the edit page must render a form, and that form's
// Save button must reach the REAL updateProduct (real validation, real
// manage_products gate). Only the session, the DB and the framework edges are
// faked. No DOM library in this repo: client components are rendered with
// react-dom/server, with the Button capturing its onClick and useTransition
// run inline.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";

const { who, pushed, clicks, pendingSaves, writes, fakeProduct } = vi.hoisted(() => ({
  who: { session: null as unknown },
  pushed: [] as string[],
  clicks: [] as { children: unknown; onClick?: () => void; disabled?: boolean }[],
  pendingSaves: [] as Promise<unknown>[],
  writes: [] as Record<string, unknown>[],
  fakeProduct: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("@/lib/env", () => ({ env: { A17_CLOSED_DEAL_FLOW: false } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "en" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (p: string) => pushed.push(p), refresh: vi.fn() }),
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  // The server renderer's startTransition throws; run the callback and keep its promise instead.
  useTransition: () => [false, (fn: () => Promise<unknown>) => { pendingSaves.push(fn()); }],
}));
vi.mock("@/components/ui/button", () => ({
  Button: (p: { children: unknown; onClick?: () => void; disabled?: boolean; asChild?: boolean }) => {
    clicks.push(p);
    return h("button", { disabled: p.disabled }, p.children as never);
  },
}));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), auditTx: vi.fn(async () => {}) }));

// Prisma Decimal columns read back as Decimals; stored strings need the same shape.
const dec = (v: unknown) => (typeof v === "string" ? new Prisma.Decimal(v) : v);
const DECIMAL_COLS = new Set(["listedPrice", "discountedPrice", "bookingFee", "monthlyInstalment12", "monthlyInstalment24"]);
const PRODUCT_ID = "11111111-1111-1111-1111-111111111111";
const row: Record<string, unknown> = {
  id: PRODUCT_ID, productCode: "FUN-BASE", productName: "Basic Funeral Pakcage", productCategory: "Funeral",
  defaultCompanyId: null, commissionType: "Percentage", closingCommPct: dec("10"), closingCommFixed: null,
  companyCutPct: dec("2"), companyCutType: "Percentage", smOverridePct: dec("5"), smOverrideType: "Percentage",
  sdOverridePct: dec("3"), sdOverrideType: "Percentage", isExternal: false, externalCompanyRetainedPct: null,
  effectiveDate: new Date("2099-01-01"), activeStatus: "Active", requiresAshesAgreement: false, requiredDocuments: [],
  comCodes: [], defaultCompany: null,
  listedPrice: dec("999.99"), discountedPrice: null, closingBasis: "ListedPrice", instalmentOption: "None",
  bookingFee: null, monthlyInstalment12: null, monthlyInstalment24: null,
};
Object.assign(fakeProduct, {
  findUnique: vi.fn(async () => ({ ...row })),
  findMany: vi.fn(async () => [{ ...row }]),
  update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    writes.push(data);
    return { ...row, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, DECIMAL_COLS.has(k) ? dec(v) : v])) };
  }),
});
vi.mock("@/lib/db", () => {
  const prisma = {
    product: fakeProduct,
    company: { findMany: vi.fn(async () => []) },
    $transaction: async (fn: (db: unknown) => unknown) => fn(prisma),
  };
  return { prisma };
});

import ProductsPage from "@/app/admin/products/page";
import EditProductPage from "@/app/admin/products/[id]/edit/page";
import { EditProductLink } from "@/app/admin/products/product-controls";

const session = (role: string) => ({ user: { id: "22222222-2222-2222-2222-222222222222", associateId: null, role } });
const ADMIN = session("Admin");
const ACCOUNTS = session("Accounts");

beforeEach(() => { vi.clearAllMocks(); who.session = null; pushed.length = 0; clicks.length = 0; pendingSaves.length = 0; writes.length = 0; });

/** Opens the edit page as the current session and returns its rendered HTML. */
async function openEditPage(): Promise<string> {
  const el = (await EditProductPage({ params: Promise.resolve({ id: PRODUCT_ID }) })) as ReactElement;
  return renderToStaticMarkup(el);
}
async function clickSave() {
  const save = clicks.find((c) => c.children === "saveProductBtn");
  expect(save, "no Save button rendered").toBeTruthy();
  expect(save!.disabled).toBe(false);
  save!.onClick!();
  await Promise.all(pendingSaves);
}

describe("product edit — the UI path reaches updateProduct", () => {
  it("Admin: the list links to the edit page, the page renders the form, Save writes the row", async () => {
    who.session = ADMIN;
    const list = renderToStaticMarkup((await ProductsPage()) as ReactElement);
    expect(list).toContain(`href="/admin/products/${PRODUCT_ID}/edit"`);

    const page = await openEditPage();
    expect(page).toContain("Basic Funeral Pakcage"); // prefilled from the product

    // No DOM to retype a field, so assert the wiring: the form's Save handler sends its
    // values through the real action to the DB write (productCode is never among them).
    await clickSave();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ productName: "Basic Funeral Pakcage", productCategory: "Funeral", listedPrice: "999.99" });
    expect(writes[0]).not.toHaveProperty("productCode");
    expect(pushed).toEqual(["/admin/products"]);
  });

  it("Accounts: cannot open the page, never sees the link, and the action refuses if invoked anyway", async () => {
    who.session = ACCOUNTS;
    // The control itself renders nothing without the capability...
    expect(renderToStaticMarkup(h(EditProductLink, { productId: PRODUCT_ID, canManage: false }))).toBe("");
    // ...the list page redirects Accounts away before any control exists...
    await expect(ProductsPage()).rejects.toThrow("REDIRECT:/admin/dashboard");
    // ...the edit page does the same, off the same capability the action checks...
    await expect(openEditPage()).rejects.toThrow("REDIRECT:/admin/dashboard");
    // ...and an Admin's form submitted under an Accounts session is refused by the action.
    who.session = ADMIN;
    await openEditPage();
    who.session = ACCOUNTS;
    await clickSave();
    expect(writes).toHaveLength(0);
    expect(pushed).toEqual([]);
  });

  it("Admin sees the control when canManage is true", () => {
    const html = renderToStaticMarkup(h(EditProductLink, { productId: PRODUCT_ID, canManage: true }));
    expect(html).toContain(`href="/admin/products/${PRODUCT_ID}/edit"`);
  });
});
