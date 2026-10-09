"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { updateProduct } from "@/server/products/actions";
import { PricingCard, type PricingValue } from "../../pricing-card";
import { CommissionCard, type CommissionValue } from "../../commission-card";
import { PRODUCT_DESCRIPTION_MAX } from "@/lib/product-limits";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export type EditProductInitial = {
  productName: string;
  productCategory: string;
  description: string;
  defaultCompanyId: string;
  pricing: PricingValue;
  commission: CommissionValue;
};

// Fields mirror productDetailsSchema: everything the create form has except
// the product code, which is immutable (it links historical sales and rate
// history to the product) and so is shown in the page header, not as an input.
export function EditProductForm({
  productId,
  companies,
  initial,
  earliestEffectiveDate,
}: {
  productId: string;
  companies: { id: string; name: string }[];
  initial: EditProductInitial;
  /** yyyy-mm-dd: a rate change may not take effect before this (see RATE_CHANGE_FLOOR_DAYS_AHEAD). */
  earliestEffectiveDate: string;
}) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [productName, setProductName] = useState(initial.productName);
  const [productCategory, setProductCategory] = useState(initial.productCategory);
  const [description, setDescription] = useState(initial.description);
  const [defaultCompanyId, setDefaultCompanyId] = useState(initial.defaultCompanyId);
  const [pricing, setPricing] = useState<PricingValue>(initial.pricing);
  const setPricingPatch = (patch: Partial<PricingValue>) => setPricing((p) => ({ ...p, ...patch }));
  const [commission, setCommission] = useState<CommissionValue>(initial.commission);
  const setCommissionPatch = (patch: Partial<CommissionValue>) => setCommission((c) => ({ ...c, ...patch }));
  // Saving a changed commission structure starts a NEW rate version on the
  // effective date (sales already verified keep the rates they were closed
  // under) — say so, and flag a past date, which the server refuses.
  const commissionChanged = JSON.stringify(commission) !== JSON.stringify(initial.commission);
  const dateInPast = commissionChanged && commission.effectiveDate < earliestEffectiveDate;

  const orUndef = (s: string) => (s.trim() === "" ? undefined : s);

  const incomplete =
    !productName.trim() ||
    !pricing.listedPrice ||
    (pricing.instalmentPlans.length > 0 && !pricing.bookingFee) ||
    pricing.instalmentPlans.some((p) => !p.months || !p.monthlyAmount);

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await updateProduct(productId, {
        productName,
        productCategory: orUndef(productCategory),
        description: orUndef(description),
        defaultCompanyId: orUndef(defaultCompanyId),
        ...commission,
        listedPrice: pricing.listedPrice,
        discountedPrice: orUndef(pricing.discountedPrice),
        closingBasis: pricing.closingBasis,
        bookingFee: orUndef(pricing.bookingFee),
        instalmentPlans: pricing.instalmentPlans.map((p) => ({ months: Number(p.months), monthlyAmount: p.monthlyAmount })),
      });
      if (r.ok) router.push("/admin/products");
      else setError(r.error ?? t("couldNotSaveProduct"));
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">{t("productNameLabel")}</Label>
            <Input id="name" value={productName} onChange={(e) => setProductName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cat">{t("categoryLabel")}</Label>
            <Input id="cat" value={productCategory} onChange={(e) => setProductCategory(e.target.value)} placeholder="Funeral" />
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="desc">{t("descriptionLabel")}</Label>
              <span className="text-[11px] text-muted-2">{description.length}/{PRODUCT_DESCRIPTION_MAX}</span>
            </div>
            <textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={PRODUCT_DESCRIPTION_MAX}
              rows={3}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-action focus:outline-none"
            />
          </div>
          <div>
            <Label htmlFor="co">{t("defaultBillingEntityLabel")}</Label>
            <select id="co" className={selectCls} value={defaultCompanyId} onChange={(e) => setDefaultCompanyId(e.target.value)}>
              <option value="">{t("noDefaultEntity")}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <PricingCard value={pricing} onChange={setPricingPatch} />

      <CommissionCard value={commission} onChange={setCommissionPatch} pricing={pricing}>
        {commissionChanged && (
          <p className="mb-4 rounded-lg bg-paper-50 px-3 py-2 text-[12px] text-body">
            {t("rateChangeNote")}
            {dateInPast && <b className="mt-1 block text-danger">{t("rateChangeDateInPast")}</b>}
          </p>
        )}
      </CommissionCard>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className="flex gap-3">
        <Button onClick={submit} disabled={pending || incomplete}>
          {pending ? tc("saving") : t("saveProductBtn")}
        </Button>
        <Button variant="ghost" onClick={() => router.push("/admin/products")} disabled={pending}>
          {tc("cancel")}
        </Button>
      </div>
    </div>
  );
}
