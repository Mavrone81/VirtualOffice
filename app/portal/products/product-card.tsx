import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { formatSGD, D, effectivePrice as computeEffectivePrice } from "@/lib/money";
import type { PortalCatalogueProduct } from "@/server/products/portal-catalogue";
import { CommissionBlock } from "./commission-cut";

export function ProductCard({ p, t }: { p: PortalCatalogueProduct; t: (key: string) => string }) {
  const effective = p.listedPrice != null ? computeEffectivePrice(p.listedPrice, p.discountedPrice).toFixed(2) : null;
  const hasDiscount = p.discountedPrice != null && p.listedPrice != null;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-ink">{p.productCode}</div>
          <div className="text-[13px] text-ink">{p.productName}</div>
          <div className="mt-0.5 text-[12px] text-muted">
            {p.productCategory ?? "—"} · {p.companyName}
          </div>
        </div>
        <StatusPill status={p.activeStatus} />
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

      {p.instalmentOption !== "None" && (
        <div className="mt-2 space-y-0.5 text-[12px] text-muted">
          <div className="font-medium text-ink">{t("instalmentOptionLabel")}: {t(p.instalmentOption === "Months12" ? "instalment12Months" : "instalmentBuyerChoice")}</div>
          {p.bookingFee != null && (
            <div>
              {t("bookingFeeLabel")}: <b className="text-ink">{formatSGD(D(p.bookingFee))}</b>
            </div>
          )}
          {p.monthlyInstalment12 != null && (
            <div>
              {p.instalmentOption === "Months12or24" ? t("hint12Months") : t("monthlyInstalmentLabel")}:{" "}
              <b className="text-ink">{formatSGD(D(p.monthlyInstalment12))}</b>
            </div>
          )}
          {p.monthlyInstalment24 != null && (
            <div>
              {t("hint24Months")}: <b className="text-ink">{formatSGD(D(p.monthlyInstalment24))}</b>
            </div>
          )}
        </div>
      )}

      <CommissionBlock
        commissionType={p.commissionType}
        closingCommPct={p.closingCommPct}
        closingCommFixed={p.closingCommFixed}
        effectivePrice={effective}
        t={t}
      />
    </Card>
  );
}
