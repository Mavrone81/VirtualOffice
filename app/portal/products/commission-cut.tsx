import { pctOf, formatSGD } from "@/lib/money";
import { commissionDisplay } from "@/lib/commission-display";

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
  effectivePrice,
  t,
}: {
  commissionType: "Percentage" | "Fixed";
  closingCommPct: string | null;
  closingCommFixed: string | null;
  /** Effective (discounted ?? listed) price — the base a % is computed on. Null if no price is set yet. */
  effectivePrice: string | null;
  t: (key: string) => string;
}) {
  const display = commissionDisplay(commissionType, closingCommPct, closingCommFixed);
  if (display == null) return null;

  const commissionAmount =
    effectivePrice != null && commissionType === "Percentage" && closingCommPct != null ? pctOf(effectivePrice, closingCommPct) : null;

  return (
    <div className="mt-3 text-[12px] text-muted">
      {t("closing")}{" "}
      <b className="text-ink">
        {display}
        {commissionAmount != null && ` (${formatSGD(commissionAmount)})`}
      </b>
    </div>
  );
}
