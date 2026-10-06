import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProductDetailPanel } from "./product-detail-panel";
import type { ProductBreakdownRow } from "@/server/commission/product-breakdown";

// Same identity-mock convention as commission-card.test.tsx.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key) }));

afterEach(cleanup);

describe("ProductDetailPanel — the second screen, F2 (item 4 follow-up)", () => {
  // F2: the external row used to render ONLY a flat "provider keeps X% ·
  // company Y%" note — no associate payout shown at all, and that note's own
  // percentages were the OLD flat split, not the engine's real figures. This
  // asserts the actual rendered DOM carries the real breakdown, including
  // the negative company-retained case.
  it("an external, uniform-percentage product renders the full breakdown — provider, net to closer, both overrides, and the NEGATIVE company-retained figure", () => {
    const row: ProductBreakdownRow = {
      productCode: "PETCRE", productName: "Mini Sized Pets", kind: "external",
      providerKeepsPct: "95%", netToCloser: "90%", directOverride: "3%", secondOverride: "2%", companyRetained: "-90%",
    };
    render(<ProductDetailPanel rows={[row]} />);
    expect(screen.getByText("95%")).toBeTruthy(); // provider payable
    expect(screen.getByText("90%")).toBeTruthy(); // net to closer
    expect(screen.getByText("3%")).toBeTruthy(); // direct override
    expect(screen.getByText("2%")).toBeTruthy(); // second override
    expect(screen.getByText("-90%")).toBeTruthy(); // company retained, negative, and it reaches the screen
  });

  // The Fixed/mixed-type external fallback (no production instance) still
  // renders something true, not a number invented for it.
  it("an external, Fixed-type product (no production instance) renders the provider-only fallback, not an invented figure", () => {
    const row: ProductBreakdownRow = { productCode: "P5", productName: "Product Five", kind: "external", providerKeepsPct: "95%" };
    render(<ProductDetailPanel rows={[row]} />);
    expect(screen.getByText(/externalProviderOnlyNote/)).toBeTruthy();
    expect(screen.queryByText("colNetToCloser")).toBeNull();
  });

  // Control: internal rows are unaffected by this change.
  it("an internal, uniform product still renders exactly as before", () => {
    const row: ProductBreakdownRow = {
      productCode: "P1", productName: "Product One", kind: "uniform",
      netToCloser: "90%", directOverride: "3%", secondOverride: "2%", companyRetained: "5%",
    };
    render(<ProductDetailPanel rows={[row]} />);
    expect(screen.getByText("90%")).toBeTruthy();
    expect(screen.getByText("5%")).toBeTruthy();
  });
});
