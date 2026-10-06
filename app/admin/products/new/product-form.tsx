"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { createProduct, type ProductInput } from "@/server/products/actions";
import { PricingCard, emptyPricing, type PricingValue } from "../pricing-card";
import { CommissionCard } from "../commission-card";
import { PRODUCT_DESCRIPTION_MAX } from "@/lib/product-limits";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function ProductForm({ companies, today }: { companies: { id: string; name: string }[]; today: string }) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
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
          <div className="sm:col-span-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="desc">{t("descriptionLabel")}</Label>
              <span className="text-[11px] text-muted-2">{(f.description ?? "").length}/{PRODUCT_DESCRIPTION_MAX}</span>
            </div>
            <textarea
              id="desc"
              value={f.description ?? ""}
              onChange={(e) => set({ description: e.target.value })}
              maxLength={PRODUCT_DESCRIPTION_MAX}
              rows={3}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-action focus:outline-none"
            />
          </div>
          <div>
            <Label htmlFor="co">{t("defaultBillingEntityLabel")}</Label>
            <select id="co" className={selectCls} value={f.defaultCompanyId ?? ""} onChange={(e) => set({ defaultCompanyId: e.target.value })}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <PricingCard value={pricing} onChange={setPricingPatch} />

      <CommissionCard value={f} onChange={set} pricing={pricing} />

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <Button onClick={submit} disabled={pending || !f.productCode || !f.productName || pricingIncomplete}>
        {pending ? tc("creating") : t("createProductBtn")}
      </Button>
    </div>
  );
}
