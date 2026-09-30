import { pctOf, formatSGD, D } from "@/lib/money";

// Commission only, as configured for this product — shown to the associate.
// Company cut is not shown here: it is internal commission structure, kept
// in the admin area, and selected out of the portal's own product read
// entirely (server/products/portal-catalogue.ts), not merely omitted from
// this render. External products don't use this block at all — see the
// isExternal branch in product-card.tsx.
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
  const commissionAmount =
    effectivePrice != null && commissionType === "Percentage" && closingCommPct != null ? pctOf(effectivePrice, closingCommPct) : null;

  return (
    <div className="mt-3 text-[12px] text-muted">
      {t("closing")}{" "}
      <b className="text-ink">
        {commissionType === "Fixed" ? formatSGD(D(closingCommFixed ?? "0")) : `${closingCommPct ?? 0}%`}
        {commissionAmount != null && ` (${formatSGD(commissionAmount)})`}
      </b>
    </div>
  );
}
