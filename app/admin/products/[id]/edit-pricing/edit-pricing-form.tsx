"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { updateProductPricing } from "@/server/products/actions";
import { PricingCard, type PricingValue } from "../../pricing-card";

export function EditPricingForm({ productId, initial }: { productId: string; initial: PricingValue }) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [pricing, setPricing] = useState<PricingValue>(initial);
  const set = (patch: Partial<PricingValue>) => setPricing((p) => ({ ...p, ...patch }));

  const orUndef = (s: string) => (s.trim() === "" ? undefined : s);

  const incomplete =
    !pricing.listedPrice ||
    (pricing.instalmentPlans.length > 0 && !pricing.bookingFee) ||
    pricing.instalmentPlans.some((p) => !p.months || !p.monthlyAmount);

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await updateProductPricing(productId, {
        listedPrice: pricing.listedPrice,
        discountedPrice: orUndef(pricing.discountedPrice),
        closingBasis: pricing.closingBasis,
        bookingFee: orUndef(pricing.bookingFee),
        instalmentPlans: pricing.instalmentPlans.map((p) => ({ months: Number(p.months), monthlyAmount: p.monthlyAmount })),
      });
      if (r.ok) router.push("/admin/products");
      else setError(r.error ?? t("couldNotSavePricing"));
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PricingCard value={pricing} onChange={set} />
      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className="flex gap-3">
        <Button onClick={submit} disabled={pending || incomplete}>
          {pending ? tc("saving") : t("savePricingBtn")}
        </Button>
        <Button variant="ghost" onClick={() => router.push("/admin/products")} disabled={pending}>
          {tc("cancel")}
        </Button>
      </div>
    </div>
  );
}
