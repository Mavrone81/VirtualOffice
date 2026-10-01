"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { PercentAmountInput } from "@/components/ui/percent-amount-input";
import { createProduct, type ProductInput } from "@/server/products/actions";
import { computeProductPreview, isOverAllocated } from "@/lib/commission-preview";
import { closingPrice } from "@/lib/money";
import { PricingCard, emptyPricing, type PricingValue } from "../pricing-card";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

const money = (s: string) =>
  "$" + Number(s).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ProductForm({ companies, today }: { companies: { id: string; name: string }[]; today: string }) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  // Fallback preview-only sale amount, used ONLY until a listed price is
  // entered — once there is one, the preview switches to the product's own
  // selected closing price (listed or discounted, per closingBasis) so the
  // admin sees the real figure, not a stand-in (closing-basis spec, 01 Oct).
  const [salesPreviewFallback, setSalesPreviewFallback] = useState("10000");
  const [f, setF] = useState<ProductInput>({
    productCode: "", productName: "", commissionType: "Percentage",
    // Every % is of the SALES AMOUNT. Defaults set by owner ruling 2026-09-26 (B-10):
    // closing 100 / company cut pool 10 / direct-upline 3 / second-upline 2.
    // Initial form values only — existing products keep whatever they were saved with.
    closingCommPct: "100", companyCutPct: "10", smOverridePct: "3", sdOverridePct: "2",
    companyCutType: "Percentage", smOverrideType: "Percentage", sdOverrideType: "Percentage",
    isExternal: false, effectiveDate: today, defaultCompanyId: companies[0]?.id,
  });
  const set = (patch: Partial<ProductInput>) => setF((p) => ({ ...p, ...patch }));
  const [pricing, setPricing] = useState<PricingValue>(emptyPricing);
  const setPricingPatch = (patch: Partial<PricingValue>) => setPricing((p) => ({ ...p, ...patch }));

  const pricingIncomplete =
    !pricing.listedPrice ||
    (pricing.instalmentOption !== "None" && (!pricing.bookingFee || !pricing.monthlyInstalment12)) ||
    (pricing.instalmentOption === "Months12or24" && !pricing.monthlyInstalment24);

  // The real closing price once a listed price is entered; the fallback
  // input otherwise (never stored — purely a stand-in for the preview).
  const salesAmount = pricing.listedPrice
    ? closingPrice(pricing.listedPrice, pricing.discountedPrice || null, pricing.closingBasis).toString()
    : salesPreviewFallback || "0";

  // Live breakdown so the admin sees exactly how the product pays out (§6A.2).
  const preview = useMemo(() => {
    if (f.isExternal) return null;
    try {
      return computeProductPreview({
        salesAmount,
        closing: f.commissionType === "Fixed"
          ? { value: f.closingCommFixed || "0", percent: false }
          : { value: f.closingCommPct || "0", percent: true },
        companyCutPool: { value: f.companyCutPct || "0", percent: f.companyCutType !== "Absolute" },
        smOverride: { value: f.smOverridePct || "0", percent: f.smOverrideType !== "Absolute" },
        sdOverride: { value: f.sdOverridePct || "0", percent: f.sdOverrideType !== "Absolute" },
      });
    } catch {
      return null;
    }
  }, [f, salesAmount]);

  const orUndef = (s: string) => (s.trim() === "" ? undefined : s);

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await createProduct({
        ...f,
        listedPrice: pricing.listedPrice,
        discountedPrice: orUndef(pricing.discountedPrice),
        closingBasis: pricing.closingBasis,
        instalmentOption: pricing.instalmentOption,
        bookingFee: orUndef(pricing.bookingFee),
        monthlyInstalment12: orUndef(pricing.monthlyInstalment12),
        monthlyInstalment24: orUndef(pricing.monthlyInstalment24),
      });
      if (r.ok) router.push("/admin/products");
      else setError(r.error ?? t("couldNotCreate"));
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="code">{t("productCodeLabel")}</Label>
            <Input id="code" value={f.productCode} onChange={(e) => set({ productCode: e.target.value.toUpperCase() })} placeholder="FUN-BASE" />
          </div>
          <div>
            <Label htmlFor="name">{t("productNameLabel")}</Label>
            <Input id="name" value={f.productName} onChange={(e) => set({ productName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="cat">{t("categoryLabel")}</Label>
            <Input id="cat" value={f.productCategory ?? ""} onChange={(e) => set({ productCategory: e.target.value })} placeholder="Funeral" />
          </div>
          <div>
            <Label htmlFor="co">{t("defaultBillingEntityLabel")}</Label>
            <select id="co" className={selectCls} value={f.defaultCompanyId ?? ""} onChange={(e) => set({ defaultCompanyId: e.target.value })}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="eff">{t("effectiveDateLabel")}</Label>
            <Input id="eff" type="date" value={f.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />
          </div>
          <label className="flex items-end gap-2 pb-3 text-[13px] text-body">
            <input type="checkbox" checked={f.isExternal} onChange={(e) => set({ isExternal: e.target.checked })} />
            {t("externalProductLabel")}
          </label>
        </div>
      </Card>

      <PricingCard value={pricing} onChange={setPricingPatch} />

      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">{t("commissionHeading")}</h2>
        {f.isExternal ? (
          <div className="max-w-xs">
            <Label htmlFor="ext">{t("enshrineRetainedLabel")}</Label>
            <Input id="ext" value={f.externalCompanyRetainedPct ?? "5"} onChange={(e) => set({ externalCompanyRetainedPct: e.target.value })} />
            <p className="mt-1 text-[12px] text-muted-2">{t("externalProviderNote")}</p>
          </div>
        ) : (
          <>
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
              </div>
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

            {/* Live breakdown — every % is of the selected closing price (§6A.2, closing-basis spec). */}
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
                  <dt className="font-semibold text-ink">{t("companyRetainedLabel")}</dt>
                  <dd className="text-right font-semibold text-ink">{money(preview.companyRetained)}</dd>
                </dl>
              ) : (
                <p className="text-[12px] text-muted-2">{t("previewEnterNumbers")}</p>
              )}
              {preview && isOverAllocated(preview) && (
                <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-[12px] text-danger">{t("overAllocatedWarning")}</p>
              )}
            </div>
          </>
        )}
      </Card>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <Button onClick={submit} disabled={pending || !f.productCode || !f.productName || pricingIncomplete}>
        {pending ? tc("creating") : t("createProductBtn")}
      </Button>
    </div>
  );
}
