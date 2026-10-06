import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ProductForm } from "./product-form";

// Same identity-mock convention as commission-card.test.tsx: a key renders as
// itself, which is enough here since nothing in these tests reads real copy.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

// Typed via the generic rather than an unused parameter (the repo's convention,
// cf. server/dashboard/metrics.test.ts) so `mock.calls[0][0]` still types.
const createProduct = vi.fn<(input: Record<string, unknown>) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock("@/server/products/actions", () => ({ createProduct: (input: Record<string, unknown>) => createProduct(input) }));

afterEach(() => {
  cleanup();
  createProduct.mockClear();
});

function fillRequired() {
  fireEvent.change(screen.getByLabelText("productCodeLabel"), { target: { value: "FUN-X" } });
  fireEvent.change(screen.getByLabelText("productNameLabel"), { target: { value: "Test Product" } });
  fireEvent.change(screen.getByLabelText("listedPriceLabel"), { target: { value: "5000" } });
}

async function submit() {
  fireEvent.click(screen.getByText("createProductBtn"));
  await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
  return createProduct.mock.calls[0][0];
}

describe("ProductForm — new-product defaults (item 4 follow-up, Part 2)", () => {
  // An internal product must start exactly as it always has — PD's B-10
  // defaults, unconditionally. Pins the baseline the external fix below must
  // not disturb.
  it("an INTERNAL product still submits PD's B-10 defaults (100/10/3/2), untouched", async () => {
    render(<ProductForm companies={[]} today="2026-10-06" />);
    fillRequired();
    const submitted = await submit();
    expect(submitted).toMatchObject({
      isExternal: false, closingCommPct: "100", companyCutPct: "10", smOverridePct: "3", sdOverridePct: "2",
    });
    expect(submitted.externalCompanyRetainedPct).toBeUndefined();
  });

  // The actual bug: ticking "external" without typing into any rate field
  // used to submit the SAME internal defaults (100/10/3/2) — inert numbers
  // nobody chose, now live because the engine reads them for an external
  // line. They must come through as zero instead.
  it("a new EXTERNAL product stores ZERO for closing/cut/SM/SD when the admin never touches them", async () => {
    render(<ProductForm companies={[]} today="2026-10-06" />);
    fillRequired();
    fireEvent.click(screen.getByLabelText("externalProductLabel"));
    const submitted = await submit();
    expect(submitted).toMatchObject({
      isExternal: true, closingCommPct: "0", companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0",
    });
  });

  // The third, separate bug: commission-card.tsx displays
  // externalCompanyRetainedPct ?? "5" as the screen's default, but the form
  // never seeded it — so the admin saw "5" while null/undefined was what
  // would be stored. The displayed default and the submitted default must
  // be the same value.
  it("the retained-% the screen shows by default ('5') is what gets stored, untouched", async () => {
    render(<ProductForm companies={[]} today="2026-10-06" />);
    fillRequired();
    fireEvent.click(screen.getByLabelText("externalProductLabel"));
    expect((screen.getByLabelText("enshrineRetainedLabel") as HTMLInputElement).value).toBe("5");
    const submitted = await submit();
    expect(submitted.externalCompanyRetainedPct).toBe("5");
  });

  // A field the admin actually typed into is never silently overwritten by
  // the zero-default, on either side of the toggle.
  it("a value the admin typed before going external survives the toggle; only the untouched fields zero", async () => {
    render(<ProductForm companies={[]} today="2026-10-06" />);
    fillRequired();
    fireEvent.change(screen.getByLabelText("closingAmountPct"), { target: { value: "42" } });
    fireEvent.click(screen.getByLabelText("externalProductLabel"));
    const submitted = await submit();
    expect(submitted).toMatchObject({
      isExternal: true, closingCommPct: "42", companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0",
    });
  });

  // Round-trip: ticking external then unticking it again, without typing
  // anything, must land back on the exact internal defaults — not stuck at
  // zero, and not carrying a leftover externalCompanyRetainedPct.
  it("toggling external on and back off, untouched, restores the internal defaults exactly", async () => {
    render(<ProductForm companies={[]} today="2026-10-06" />);
    fillRequired();
    const checkbox = screen.getByLabelText("externalProductLabel");
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    const submitted = await submit();
    expect(submitted).toMatchObject({
      isExternal: false, closingCommPct: "100", companyCutPct: "10", smOverridePct: "3", sdOverridePct: "2",
    });
    expect(submitted.externalCompanyRetainedPct).toBeUndefined();
  });
});
