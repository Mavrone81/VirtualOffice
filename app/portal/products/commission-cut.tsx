import { pctOf, formatSGD } from "@/lib/money";
import { commissionDisplay } from "@/lib/commission-display";

export type Translator = {
  (key: string, values?: Record<string, string>): string;
  rich: (key: string, values: Record<string, string | ((chunks: React.ReactNode) => React.ReactNode)>) => React.ReactNode;
};

// Commission only, as configured for this product — shown to the associate,
// the same way for every product regardless of how it's sourced. Company
// cut is not shown here at all: it is internal commission structure, kept
// in the admin area, and selected out of the portal's own product read
// entirely (server/products/portal-catalogue.ts), not merely omitted from
// this render. Renders nothing when there's no real commission to show
// (null or zero, by design for some products) — see lib/commission-display.ts.
export function CommissionBlock({
  commissionType,
  closingCommPct,
  closingCommFixed,
  closingBasisPrice,
  closingBasis,
  t,
}: {
  commissionType: "Percentage" | "Fixed";
  closingCommPct: string | null;
  closingCommFixed: string | null;
  /** The product's own selected closing price (lib/money.ts closingPrice — listed or
   *  discounted, per closingBasis), the base a % is computed on. Null if no price is set yet. */
  closingBasisPrice: string | null;
  closingBasis: "ListedPrice" | "DiscountedPrice";
  t: Translator;
}) {
  const display = commissionDisplay(commissionType, closingCommPct, closingCommFixed);
  if (display == null) return null;

  const commissionAmount =
    closingBasisPrice != null && commissionType === "Percentage" && closingCommPct != null ? pctOf(closingBasisPrice, closingCommPct) : null;

  // Amount-first, naming AND printing the base on one line (01 Oct, UIUX/AD/PD):
  // a reader who stops at a bare percentage next to the BUYER price (which can
  // differ from the commission base) does the wrong multiplication; stopping
  // at "Commission $X" leaves nothing left to compute. Only reachable for
  // Percentage commission with a known base price — Fixed commission and the
  // no-price-yet case fall through to the plain line below, unchanged.
  // t.rich (not t) so the amount keeps the SAME bold weight every other
  // commission figure on this screen has — a plain string interpolation
  // would lose the <b> and make the one line most likely to be misread the
  // least visually prominent one on the page (UIUX catch, 01 Oct).
  if (commissionAmount != null) {
    return (
      <div className="mt-3 text-[12px] text-muted">
        {t.rich("commissionWithBasis", {
          b: (chunks) => <b className="text-ink">{chunks}</b>,
          amount: formatSGD(commissionAmount),
          pct: display,
          basis: t(closingBasis === "DiscountedPrice" ? "basisDiscountedPriceLower" : "basisListedPriceLower"),
          base: formatSGD(closingBasisPrice as string),
        })}
      </div>
    );
  }

  return (
    <div className="mt-3 text-[12px] text-muted">
      {t("closing")} <b className="text-ink">{display}</b>
    </div>
  );
}
