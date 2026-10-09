import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { formatSGD, D, effectivePrice as computeEffectivePrice, closingPrice } from "@/lib/money";
import type { PortalCatalogueProduct } from "@/server/products/portal-catalogue";
import { CommissionBlock, type Translator } from "./commission-cut";

export function ProductCard({ p, t, tc }: { p: PortalCatalogueProduct; t: Translator; tc: (key: string) => string }) {
  // What the buyer pays — unaffected by closingBasis, which only selects what
  // commission is calculated on (owner's words: "it should be the same as
  // listed price … commission, upline comm etc. are calculated based on closing").
  const effective = p.listedPrice != null ? computeEffectivePrice(p.listedPrice, p.discountedPrice).toFixed(2) : null;
  const hasDiscount = p.discountedPrice != null && p.listedPrice != null;
  const closingBasisPrice = p.listedPrice != null ? closingPrice(p.listedPrice, p.discountedPrice, p.closingBasis).toFixed(2) : null;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-ink">{p.productCode}</div>
          <div className="text-[13px] text-ink">{p.productName}</div>
          <div className="mt-0.5 text-[12px] text-muted">
            {p.productCategory ?? "—"} · {p.companyName}
          </div>
          {/* Validated up to 500 chars server-side (lib/schemas.ts) — clamped
              visually here too, independently of whatever length passed
              validation, so it can't blow out this dense a card. */}
          {p.description && <div className="mt-1 line-clamp-2 text-[12px] text-muted">{p.description}</div>}
        </div>
        <StatusPill status={p.activeStatus} label={p.activeStatus === "Active" ? tc("active") : tc("inactive")} />
      </div>

      <div className="mt-3">
        {effective == null ? (
          <div className="text-[15px] text-muted-2">{t("priceNotSet")}</div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[20px] text-ink">{formatSGD(D(effective))}</span>
            {hasDiscount && <span className="text-[13px] text-muted-2 line-through">{formatSGD(D(p.listedPrice as string))}</span>}
          </div>
        )}
      </div>

      {p.instalmentPlans.length > 0 && (
        <div className="mt-2 space-y-0.5 text-[12px] text-muted">
          {p.bookingFee != null && (
            <div>
              {t("bookingFeeLabel")}: <b className="text-ink">{formatSGD(D(p.bookingFee))}</b>
            </div>
          )}
          {p.instalmentPlans.map((plan) => (
            plan.monthlyAmount != null && (
              <div key={plan.months}>
                {t("portalInstalmentFor", { months: String(plan.months) })}: <b className="text-ink">{formatSGD(D(plan.monthlyAmount))}</b>
              </div>
            )
          ))}
        </div>
      )}

      <CommissionBlock
        commissionType={p.commissionType}
        closingCommPct={p.closingCommPct}
        closingCommFixed={p.closingCommFixed}
        closingBasisPrice={closingBasisPrice}
        closingBasis={p.closingBasis}
        t={t}
      />
    </Card>
  );
}
