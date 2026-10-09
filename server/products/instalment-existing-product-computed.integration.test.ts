// The owner's exact bug (2026-10-09 follow-up): PD tested the shipped
// instalment feature and found that an EXISTING product's plan rows loaded
// with `touched: true` (see the merged pricing-card.tsx's old
// InstalmentPlanValue doc comment), so the edit screen never recomputed the
// monthly amount for a previously-saved plan — it just showed back whatever
// was stored, frozen, even after the price changed underneath it.
//
// This test proves the fix at the one level that actually exercises it: a
// REAL product, created then edited through the REAL server actions (never
// mocked), with its REAL edit-pricing SCREEN rendered end to end. If
// `touched`/stored monthlyAmount were still in play anywhere on this path,
// the price edit below would leave the screen showing the OLD figure
// (333.33/333.34, computed at creation) — this test only passes if the
// screen instead shows the NEW one (666.66/666.68), derived fresh from the
// price as it stands after the edit.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
// Interpolates params into the output (unlike a bare identity mock) so an
// assertion on a formatted dollar figure passed as a t() param — like the
// final-instalment line below — can actually see it in the rendered HTML.
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
  useLocale: () => "en",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import { prisma } from "@/lib/db";
import { createProduct, updateProduct, type ProductInput } from "./actions";
import EditProductPricingPage from "@/app/admin/products/[id]/edit-pricing/page";

const TAG = "EXISTCOMP-";
const ADMIN = { user: { id: "66666666-6666-6666-6666-666666666666", associateId: null, role: "Admin" } };
const BASE_RATES = {
  commissionType: "Percentage" as const, closingCommPct: "10", companyCutPct: "2",
  smOverridePct: "5", sdOverridePct: "3", isExternal: false, effectiveDate: "2099-01-01",
};

let productId = "";

beforeAll(async () => {
  who.session = ADMIN;
  // Saved at price 1000 / fee 0 / 3 months — the schedule at creation is
  // 333.33 regular, 333.34 final.
  const created = await createProduct({
    productCode: TAG + "1", productName: "Fake existing-product", ...BASE_RATES,
    listedPrice: "1000.00", bookingFee: "0.00", instalmentPlans: [{ months: 3 }],
  } as ProductInput);
  expect(created).toEqual({ ok: true });
  productId = (await prisma.product.findFirstOrThrow({ where: { productCode: TAG + "1" } })).id;

  // Edited afterwards to price 2000, keeping the SAME 3-month plan — the
  // schedule at this new price is 666.66 regular, 666.68 final, a different
  // figure from what was true at creation. The plan row itself is sent back
  // unchanged (months: 3), exactly as a real screen resubmits existing rows.
  const edited = await updateProduct(productId, {
    productName: "Fake existing-product", ...BASE_RATES,
    listedPrice: "2000.00", bookingFee: "0.00", instalmentPlans: [{ months: 3 }],
  });
  expect(edited).toEqual({ ok: true });
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
});

async function renderEditPricingPage(): Promise<string> {
  const el = (await EditProductPricingPage({ params: Promise.resolve({ id: productId }) })) as ReactElement;
  return renderToStaticMarkup(el);
}

describe("an existing product's previously-saved plan displays a COMPUTED figure, not a frozen stored one", () => {
  it("the stored monthlyAmount column is never written — frozen, nullable, unread, exactly as the column comment says", async () => {
    const row = await prisma.productInstalmentPlan.findFirstOrThrow({ where: { productId, months: 3 } });
    expect(row.monthlyAmount).toBeNull();
  });

  it("the edit-pricing screen shows the figure DERIVED FROM THE CURRENT price (666.66 / final 666.68), not the figure true when the plan was first saved (333.33 / 333.34)", async () => {
    const html = await renderEditPricingPage();
    expect(html).toContain("666.66");
    expect(html).toContain("666.68");
    expect(html).not.toContain("333.33");
    expect(html).not.toContain("333.34");
  });

  it("the monthly-amount display renders no input element at all — pure display, never an editable field (the owner's 'no override allowed' ruling)", async () => {
    const html = await renderEditPricingPage();
    // Asserts on DOM SHAPE, not a formatted string: the figure renders
    // through formatSGD as "S$666.66", so a bare value="666.66" regex is
    // blind to it and would pass vacuously even with a real <input> showing
    // that exact figure. Checking every actual <input> tag's own contents
    // is immune to how the number is formatted. The length floor matters
    // just as much as the filter: without it, this passes vacuously on a
    // page that rendered no inputs at all (every OTHER money field on this
    // screen — listedPrice, bookingFee — IS a real <input>, so there must
    // be at least one; the derived monthly amount must not be among them).
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.filter((i) => /666\.6[68]/.test(i))).toEqual([]);
  });
});
