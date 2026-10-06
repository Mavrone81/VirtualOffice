import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CommissionCard, type CommissionValue } from "./commission-card";
import { emptyPricing } from "./pricing-card";

// Identity mock, same convention the rest of this suite uses for next-intl
// (lib/i18n-key-resolution.test.ts's header documents it): a key renders as
// itself. That is enough here — this file asserts on computed DOLLAR FIGURES
// and on whether a specific translation key is present at all (the warning
// banner), neither of which needs real wording.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

afterEach(cleanup);

const base: CommissionValue = {
  commissionType: "Percentage",
  closingCommPct: "10",
  companyCutPct: "2",
  smOverridePct: "5",
  sdOverridePct: "3",
  isExternal: false,
  effectiveDate: "2026-11-01",
};

function renderCard(value: CommissionValue) {
  return render(<CommissionCard value={value} onChange={() => {}} pricing={{ ...emptyPricing, listedPrice: "10000" }} />);
}

describe("CommissionCard — the preview panel actually reaches the screen (item 4, render-path trap)", () => {
  // T4. Not an assertion on the `preview` memo or computeProductPreview's
  // return value — those would pass even with the panel's old placement
  // inside the internal-only half of the isExternal ternary, which rendered
  // nothing for an external product no matter what the memo computed. This
  // queries actual rendered DOM text.
  it("T4: an external product's breakdown — including the negative company-retained figure — is visible in the rendered DOM", () => {
    renderCard({ ...base, isExternal: true, externalCompanyRetainedPct: "5" });
    // Owner's worked example: $10,000 @ 10% closing / 2% cut / 5% SM / 3% SD, 5% retained.
    expect(screen.getByText("$1,000.00")).toBeTruthy(); // closing
    expect(screen.getByText("$200.00")).toBeTruthy(); // company cut pool
    expect(screen.getByText("$500.00")).toBeTruthy(); // SM override
    expect(screen.getByText("$300.00")).toBeTruthy(); // SD override
    expect(screen.getByText("$800.00")).toBeTruthy(); // net to closer
    expect(screen.getByText("$9,500.00")).toBeTruthy(); // external provider payable
    expect(screen.getByText("$-1,100.00")).toBeTruthy(); // company retained — negative, and it reaches the screen
  });

  it("the same fields are configurable for an external product (closing/cut/SM/SD inputs are present, not hidden)", () => {
    renderCard({ ...base, isExternal: true, externalCompanyRetainedPct: "5" });
    expect(screen.getByLabelText("closingAmountPct")).toBeTruthy();
    expect(screen.getByLabelText("companyCutPoolLabel")).toBeTruthy();
    expect(screen.getByLabelText("smOverrideLabel")).toBeTruthy();
    expect(screen.getByLabelText("sdOverrideLabel")).toBeTruthy();
    expect(screen.getByLabelText("enshrineRetainedLabel")).toBeTruthy();
  });

  // T5, named exactly as the brief requires, so a future re-add of this
  // check is a renamed test someone has to notice, not a silent revert.
  it("external over-allocation renders no warning banner", () => {
    renderCard({ ...base, isExternal: true, externalCompanyRetainedPct: "5" });
    // $-1,100.00 above IS the over-allocated case for this product — confirmed
    // by the sibling test. The banner text (identity-mocked key) must still be absent.
    expect(screen.queryByText("overAllocatedWarning")).toBeNull();
  });

  // Control: the suppression in the test above is external-only, not the
  // check silently disabled for everyone. Same shape of over-allocation,
  // internal product, same banner key — must still render.
  it("control: the same shape of over-allocation DOES render the warning banner for an INTERNAL product", () => {
    renderCard({ ...base, isExternal: false, closingCommPct: "100", companyCutPct: "10", smOverridePct: "6", sdOverridePct: "5" });
    expect(screen.getByText("overAllocatedWarning")).toBeTruthy();
  });
});
