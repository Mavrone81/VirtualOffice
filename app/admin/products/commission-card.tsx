"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { PercentAmountInput } from "@/components/ui/percent-amount-input";
import { computeProductPreview, isOverAllocated } from "@/lib/commission-preview";
import { closingPrice } from "@/lib/money";
import { validateCommission } from "@/server/products/commission-edit";
import type { PricingValue } from "./pricing-card";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

const money = (s: string) =>
  "$" + Number(s).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The commission-structure fields a product carries — the same keys, with the
// same optionality, as the server's productCommissionShape (lib/schemas.ts).
export type CommissionValue = {
  commissionType: "Percentage" | "Fixed";
  closingCommPct?: string;
  closingCommFixed?: string;
  companyCutPct: string;
  companyCutType?: "Percentage" | "Absolute";
  smOverridePct: string;
  smOverrideType?: "Percentage" | "Absolute";
  sdOverridePct: string;
  sdOverrideType?: "Percentage" | "Absolute";
  isExternal: boolean;
  externalCompanyRetainedPct?: string;
  effectiveDate: string;
};

/**
 * Commission structure fields + live payout breakdown. Self-contained on
 * `value`/`onChange` (like PricingCard) so ONE component drives both the
 * new-product form and the edit-product form, prefilled either way — the two
 * screens can't drift apart in which fields they offer or how they preview.
 * `children` renders at the top of the card (the edit screen's notice about
 * what saving a rate change does).
 */
export function CommissionCard({
  value: f,
  onChange: set,
  pricing,
  children,
}: {
  value: CommissionValue;
  onChange: (patch: Partial<CommissionValue>) => void;
  pricing: PricingValue;
  children?: React.ReactNode;
}) {
  const t = useTranslations("products");
  const te = useTranslations("errors");
  // Fallback preview-only sale amount, used ONLY until a listed price is
  // entered — once there is one, the preview switches to the product's own
  // selected closing price (listed or discounted, per closingBasis) so the
  // admin sees the real figure, not a stand-in (closing-basis spec, 01 Oct).
  const [salesPreviewFallback, setSalesPreviewFallback] = useState("10000");

  // The real closing price once a listed price is entered; the fallback
  // input otherwise (never stored — purely a stand-in for the preview).
  const salesAmount = pricing.listedPrice
    ? closingPrice(pricing.listedPrice, pricing.discountedPrice || null, pricing.closingBasis).toString()
    : salesPreviewFallback || "0";

  // Live breakdown so the admin sees exactly how the product pays out (§6A.2,
  // extended 2026-10 so an external product's breakdown is computed and
  // shown too — owner ruling: pays the associate exactly like internal, on
  // top of the provider split. This used to early-return null for an
  // external product; that guard is gone, and removing it alone would not
  // have been enough on its own — the panel that renders `preview` sat
  // inside the internal-only half of a ternary below. Both are fixed
  // together: this always computes now, and the panel below always renders.
  const preview = useMemo(() => {
    try {
      return computeProductPreview({
        salesAmount,
        closing: f.commissionType === "Fixed"
          ? { value: f.closingCommFixed || "0", percent: false }
          : { value: f.closingCommPct || "0", percent: true },
        companyCutPool: { value: f.companyCutPct || "0", percent: f.companyCutType !== "Absolute" },
        smOverride: { value: f.smOverridePct || "0", percent: f.smOverrideType !== "Absolute" },
        sdOverride: { value: f.sdOverridePct || "0", percent: f.sdOverrideType !== "Absolute" },
        isExternal: f.isExternal,
        externalRetainedPct: f.externalCompanyRetainedPct || "0",
      });
    } catch {
      return null;
    }
  }, [f, salesAmount]);

  // The closing value its commission type calls for is missing. Shown for
  // external products too (2026-10): the engine now pays a closing
  // commission on one exactly as for internal, so this is no longer a
  // data-repair-only field for them.
  const closingError = validateCommission(f);
  const closingFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="ct">{t("commissionTypeLabel")}</Label>
        <select id="ct" className={selectCls} value={f.commissionType} onChange={(e) => set({ commissionType: e.target.value as "Percentage" | "Fixed" })}>
          <option value="Percentage">{t("percentageOfSale")}</option>
          <option value="Fixed">{t("fixedAmount")}</option>
        </select>
      </div>
      <div>
        <Label htmlFor="closing">{f.commissionType === "Fixed" ? t("closingAmountFixed") : t("closingAmountPct")}</Label>
        {f.commissionType === "Fixed" ? (
          <Input id="closing" value={f.closingCommFixed ?? ""} onChange={(e) => set({ closingCommFixed: e.target.value })} placeholder="1000" />
        ) : (
          <Input id="closing" value={f.closingCommPct ?? ""} onChange={(e) => set({ closingCommPct: e.target.value })} placeholder="100" />
        )}
        {closingError && <p className="mt-1 text-[12px] text-danger">{te(closingError)}</p>}
      </div>
    </div>
  );

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-display text-[17px] text-ink">{t("commissionHeading")}</h2>
      {children}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="eff">{t("effectiveDateLabel")}</Label>
          <Input id="eff" type="date" value={f.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />
        </div>
        <label className="flex items-end gap-2 pb-3 text-[13px] text-body">
          <input type="checkbox" checked={f.isExternal} onChange={(e) => set({ isExternal: e.target.checked })} />
          {t("externalProductLabel")}
        </label>
      </div>

      {/* External adds the provider-retained field on top of the SAME closing/cut/
          override inputs internal uses — owner ruling: configure it exactly like a
          non-external product. (Previously these were internal-only, and external
          showed closing only on a stored-data error; both read as "the engine
          doesn't use these for external," which stopped being true 2026-10.) */}
      {f.isExternal && (
        <div className="mb-4 max-w-xs">
          <Label htmlFor="ext">{t("enshrineRetainedLabel")}</Label>
          <Input id="ext" value={f.externalCompanyRetainedPct ?? "5"} onChange={(e) => set({ externalCompanyRetainedPct: e.target.value })} />
          <p className="mt-1 text-[12px] text-muted-2">{t("externalProviderNote")}</p>
        </div>
      )}
      {closingFields}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cut">{t("companyCutPoolLabel")}</Label>
          <PercentAmountInput
            id="cut"
            value={f.companyCutPct}
            valueType={f.companyCutType ?? "Percentage"}
            onValueChange={(v) => set({ companyCutPct: v })}
            onTypeChange={(tp) => set({ companyCutType: tp })}
            base={Number(salesAmount) || undefined}
            placeholder="2"
          />
        </div>
        <div>
          <Label htmlFor="sm">{t("smOverrideLabel")}</Label>
          <PercentAmountInput
            id="sm"
            value={f.smOverridePct}
            valueType={f.smOverrideType ?? "Percentage"}
            onValueChange={(v) => set({ smOverridePct: v })}
            onTypeChange={(tp) => set({ smOverrideType: tp })}
            base={Number(salesAmount) || undefined}
            placeholder="5"
          />
        </div>
        <div>
          <Label htmlFor="sd">{t("sdOverrideLabel")}</Label>
          <PercentAmountInput
            id="sd"
            value={f.sdOverridePct}
            valueType={f.sdOverrideType ?? "Percentage"}
            onValueChange={(v) => set({ sdOverridePct: v })}
            onTypeChange={(tp) => set({ sdOverrideType: tp })}
            base={Number(salesAmount) || undefined}
            placeholder="3"
          />
        </div>
      </div>

      {/* Live breakdown — every % is of the selected closing price (§6A.2, closing-basis
          spec). Renders for external exactly as for internal (not inside either branch
          of an isExternal check) — a panel that only rendered on one side of such a
          check previously stayed empty for every external product regardless of what
          `preview` computed. */}
      <div className="mt-5 rounded-lg border border-line bg-paper-50 p-4">
        {pricing.listedPrice ? (
          <p className="mb-3 text-[12px] text-muted-2">
            {pricing.closingBasis === "DiscountedPrice" ? t("previewOnDiscountedPrice") : t("previewOnListedPrice")}
          </p>
        ) : (
          <div className="mb-3 flex items-center gap-2">
            <Label htmlFor="salesprev" className="mb-0">{t("previewSalesAmountLabel")}</Label>
            <Input id="salesprev" className="h-9 w-40" value={salesPreviewFallback} onChange={(e) => setSalesPreviewFallback(e.target.value)} placeholder="10000" />
          </div>
        )}
        {preview ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
            <dt className="text-body">{t("closingAmountPct")}</dt><dd className="text-right font-medium text-ink">{money(preview.closing)}</dd>
            <dt className="text-body">{t("companyCutPoolLabel")}</dt><dd className="text-right text-ink">{money(preview.companyCutPool)}</dd>
            <dt className="text-body">{t("smOverrideLabel")}</dt><dd className="text-right text-ink">{money(preview.smOverride)}</dd>
            <dt className="text-body">{t("sdOverrideLabel")}</dt><dd className="text-right text-ink">{money(preview.sdOverride)}</dd>
            <dt className="mt-1 border-t border-line pt-1 font-semibold text-ink">{t("netToCloserLabel")}</dt>
            <dd className="mt-1 border-t border-line pt-1 text-right font-semibold text-action">{money(preview.netToCloser)}</dd>
            {f.isExternal && (
              <>
                <dt className="text-body">{t("externalPayableLabel")}</dt>
                <dd className="text-right text-ink">{money(preview.externalPayable)}</dd>
              </>
            )}
            <dt className="font-semibold text-ink">{t("companyRetainedLabel")}</dt>
            <dd className="text-right font-semibold text-ink">{money(preview.companyRetained)}</dd>
          </dl>
        ) : (
          <p className="text-[12px] text-muted-2">{t("previewEnterNumbers")}</p>
        )}
        {/* Suppressed for external (owner ruling: a negative company-retained figure is a
            permitted outcome of a setting the owner controls, not a warning condition —
            this banner is the warning he explicitly declined, and reusing isOverAllocated
            as-is would have fired it on essentially every external product). Internal
            behaviour is unchanged: the same check, same banner, same condition otherwise. */}
        {preview && !f.isExternal && isOverAllocated(preview) && (
          <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-[12px] text-danger">{t("overAllocatedWarning")}</p>
        )}
      </div>
    </Card>
  );
}
