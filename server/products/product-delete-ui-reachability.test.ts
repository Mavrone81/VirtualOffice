// 🔴 This file exists for the reason product-edit-ui-reachability.test.ts exists:
// in this repo a complete, correct server action has already shipped with NO screen
// that called it (updateProduct). The integration tests next door call deleteProduct
// directly, so they would pass in full even if the delete control were never
// rendered, or were rendered wired to nothing. These start at the screen instead.
//
// Two separate claims, because they fail for different reasons:
//   1. the products list actually RENDERS the control, and only for a manager
//   2. the control's confirm button reaches the REAL deleteProduct
// No DOM library in this repo: client components render through react-dom/server
// with Button capturing its onClick, the same idiom as the edit-reachability test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";

const { who, clicks, pending, calls, forceOpen, fakeProduct } = vi.hoisted(() => ({
  who: { session: null as unknown },
  clicks: [] as { children: unknown; onClick?: () => void; disabled?: boolean }[],
  pending: [] as Promise<unknown>[],
  calls: [] as string[],
  forceOpen: { on: false },
  fakeProduct: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("@/lib/env", () => ({ env: { A17_CLOSED_DEAL_FLOW: false } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k, useLocale: () => "en" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
}));
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return {
    ...real,
    // The server renderer's startTransition throws; run the callback and keep its promise.
    useTransition: () => [false, (fn: () => Promise<unknown>) => { pending.push(fn()); }],
    // The confirmation panel is behind useState. renderToStaticMarkup does one pass
    // and never re-renders, so a click cannot open it; `forceOpen` renders the
    // already-confirmed state so the confirm button itself can be reached. Only the
    // FIRST useState of the component is forced (the `open` flag); `err` keeps real
    // behaviour, so a refusal still has somewhere to land.
    useState: ((init: unknown) => (forceOpen.on && init === false ? [true, vi.fn()] : real.useState(init as never))) as unknown as typeof real.useState,
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: (p: { children: unknown; onClick?: () => void; disabled?: boolean; asChild?: boolean }) => {
    clicks.push(p);
    return h("button", { disabled: p.disabled }, p.children as never);
  },
}));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/audit")>()),
  auditTx: vi.fn(async () => { calls.push("auditTx"); }),
}));

const dec = (v: string) => new Prisma.Decimal(v);
const PRODUCT_ID = "33333333-3333-3333-3333-333333333333";
const row: Record<string, unknown> = {
  id: PRODUCT_ID, productCode: "FUN-BASE", productName: "Basic package", productCategory: "Funeral",
  defaultCompanyId: null, commissionType: "Percentage", closingCommPct: dec("10"), closingCommFixed: null,
  companyCutPct: dec("2"), companyCutType: "Percentage", smOverridePct: dec("5"), smOverrideType: "Percentage",
  sdOverridePct: dec("3"), sdOverrideType: "Percentage",
  // Real rows are NOT NULL DEFAULT 0 for these (see the managing_director_cut
  // migration), so a fixture without them is not a product that can exist.
  mdCutPct: dec("0"), mdCutType: "Percentage",
  isExternal: false, externalCompanyRetainedPct: null, externalCompanyRetainedType: "Percentage",
  effectiveDate: new Date("2099-01-01"), activeStatus: "Active", requiresAshesAgreement: false, requiredDocuments: [],
  comCodes: [], defaultCompany: null, listedPrice: dec("999.99"), discountedPrice: null,
  closingBasis: "ListedPrice", instalmentOption: "None", bookingFee: null, monthlyInstalment12: null, monthlyInstalment24: null,
};

// Counts default to 0 (nothing blocks) so the happy path is reachable; a test that
// wants a refusal raises the one count it is exercising.
const blockers = { viaVersion: 0, viaUpgrade: 0, children: 0, viaCode: 0 };

Object.assign(fakeProduct, {
  findUnique: vi.fn(async () => ({ ...row })),
  findMany: vi.fn(async () => [{ ...row }]),
  count: vi.fn(async () => blockers.children),
  delete: vi.fn(async () => { calls.push("product.delete"); return { ...row }; }),
});
vi.mock("@/lib/db", () => {
  const prisma = {
    product: fakeProduct,
    saleLineItem: {
      count: vi.fn(async (a: { where: Record<string, unknown> }) => {
        if ("structureVersion" in a.where) return blockers.viaVersion;
        if ("upgradeParentProductId" in a.where) return blockers.viaUpgrade;
        return blockers.viaCode;
      }),
    },
    comcode: { deleteMany: vi.fn(async () => { calls.push("comcode.deleteMany"); return { count: 0 }; }) },
    commissionStructureVersion: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => { calls.push("version.deleteMany"); return { count: 0 }; }),
    },
    company: { findMany: vi.fn(async () => []) },
    $queryRaw: async () => [{ id: PRODUCT_ID }],
    // deleteProduct passes an isolation level as the second argument; a mock that
    // ignored it would hide a caller that stopped passing one, so assert it here.
    $transaction: async (fn: (db: unknown) => unknown, opts?: { isolationLevel?: string }) => {
      calls.push(`tx:${opts?.isolationLevel ?? "default"}`);
      return fn(prisma);
    },
  };
  return { prisma };
});

import ProductsPage from "@/app/admin/products/page";
import { DeleteProductButton } from "@/app/admin/products/product-controls";

const session = (role: string) => ({ user: { id: "44444444-4444-4444-4444-444444444444", associateId: null, role } });

beforeEach(() => {
  vi.clearAllMocks();
  fakeProduct.findUnique.mockImplementation(async () => ({ ...row }));
  fakeProduct.findMany.mockImplementation(async () => [{ ...row }]);
  fakeProduct.count.mockImplementation(async () => blockers.children);
  who.session = null;
  clicks.length = 0; pending.length = 0; calls.length = 0;
  forceOpen.on = false;
  Object.assign(blockers, { viaVersion: 0, viaUpgrade: 0, children: 0, viaCode: 0 });
});

describe("products list — the delete control is actually on the screen", () => {
  it("renders the delete control for an admin, next to but distinct from the Active toggle", async () => {
    who.session = session("Admin");
    const html = renderToStaticMarkup((await ProductsPage()) as ReactElement);
    // The control is present...
    expect(html).toContain("deleteProduct");
    // ...and the Active toggle it must not replace is still present too.
    expect(html).toContain("active");
    // Collapsed by default: the confirmation copy is not on the page until asked for,
    // so a stray click cannot destroy anything.
    expect(html).not.toContain("deleteProductConfirm");
  });

  it("never reaches the list at all as a role that cannot manage products", async () => {
    // 🔴 This asserts the REDIRECT, not a hidden control, because instrumenting the
    // original version of this test showed it only ever took the redirect branch:
    // ProductsPage redirects anyone who is not a full admin before it renders a
    // single row, so an Accounts session can never see the control either way. The
    // earlier shape of this test accepted "redirected OR control absent", which
    // would have stayed green even if canManage had stopped hiding anything.
    // The canManage gate itself is asserted directly on the component below.
    who.session = session("Accounts");
    await expect(ProductsPage()).rejects.toThrow("REDIRECT:/admin/dashboard");
  });
});

describe("the delete control reaches the real deleteProduct", () => {
  /** Render the control in its confirming state and press the danger button. */
  async function pressConfirm(role = "Admin") {
    who.session = session(role);
    forceOpen.on = true;
    renderToStaticMarkup(
      h(DeleteProductButton, { productId: PRODUCT_ID, productCode: "FUN-BASE", productName: "Basic package", canManage: true }) as ReactElement,
    );
    const confirm = clicks.find((c) => c.children === "deleteProductConfirm");
    expect(confirm, "no confirm button rendered").toBeTruthy();
    expect(confirm!.disabled).toBe(false);
    confirm!.onClick!();
    await Promise.all(pending);
  }

  it("deletes through the real action, inside a Serializable transaction, and audits it", async () => {
    await pressConfirm();
    // Proves the button is wired to the real server action, not a stub: these are
    // the real action's own database calls, in its own order.
    expect(calls).toEqual([
      "tx:Serializable",
      "comcode.deleteMany",
      "version.deleteMany",
      "product.delete",
      "auditTx",
    ]);
  });

  it("does not delete when the real action refuses, and nothing is destroyed", async () => {
    blockers.viaUpgrade = 1; // condition (b): the link with no foreign key
    await pressConfirm();
    expect(calls).toEqual(["tx:Serializable"]);
    expect(calls).not.toContain("product.delete");
    expect(calls).not.toContain("comcode.deleteMany");
    expect(calls).not.toContain("version.deleteMany");
  });

  it("renders nothing at all when the caller cannot manage products", () => {
    forceOpen.on = true;
    const html = renderToStaticMarkup(
      h(DeleteProductButton, { productId: PRODUCT_ID, productCode: "FUN-BASE", productName: "Basic package", canManage: false }) as ReactElement,
    );
    expect(html).toBe("");
    expect(clicks).toHaveLength(0);
  });
});
