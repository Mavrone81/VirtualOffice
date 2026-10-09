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

// Pristine defaults for the rate fields a fresh toggle of isExternal should
// swap — PD's B-10 defaults for internal, zero for external, since an
// external product's closing/cut/SM/SD were previously these SAME internal
// defaults, submitted whether or not anyone chose them (the engine simply
// never read them for an external line; it does now). externalCompanyRetainedPct
// is included too: its own displayed default ("5", commission-card.tsx) was
// never seeded into form state, so an untouched field stored null while the
// screen showed "5". A field still holding the default for the side being
// LEFT is swapped to the default for the side being entered; a field the
// admin actually typed into no longer matches that default and is left alone.
type RateDefaults = Pick<ProductInput, "closingCommPct" | "companyCutPct" | "smOverridePct" | "sdOverridePct" | "mdCutPct" | "externalCompanyRetainedPct">;

/** The owner's rule: a new product's Managing Director cut defaults to 30% OF
 *  THE COMPANY CUT (2026-10-07). Expressed here rather than as a column default
 *  on purpose — a database default would re-price every product that already
 *  exists the moment the migration ran. Trailing zeros are trimmed so 30% of
 *  "10" reads "3", not "3.0000", which is what an admin would have typed. */
export function mdCutDefaultFor(companyCutPct: string | undefined): string {
  const n = Number(companyCutPct);
  if (!Number.isFinite(n)) return "0";
  return String(Number((n * 0.3).toFixed(4)));
}
const PRISTINE_INTERNAL: RateDefaults = { closingCommPct: "100", companyCutPct: "10", smOverridePct: "3", sdOverridePct: "2", mdCutPct: mdCutDefaultFor("10"), externalCompanyRetainedPct: undefined };
const PRISTINE_EXTERNAL: RateDefaults = { closingCommPct: "0", companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0", mdCutPct: mdCutDefaultFor("0"), externalCompanyRetainedPct: "5" };

// Swaps each rate field individually — only those still at the default for
// the side being left — rather than a generic keyof loop, which TypeScript
// can't type-check across fields of different optionality (closingCommPct
// etc. vs. the optional externalCompanyRetainedPct).
function swapPristineRates(p: RateDefaults, from: RateDefaults, to: RateDefaults): RateDefaults {
  return {
    closingCommPct: p.closingCommPct === from.closingCommPct ? to.closingCommPct : p.closingCommPct,
    companyCutPct: p.companyCutPct === from.companyCutPct ? to.companyCutPct : p.companyCutPct,
    smOverridePct: p.smOverridePct === from.smOverridePct ? to.smOverridePct : p.smOverridePct,
    sdOverridePct: p.sdOverridePct === from.sdOverridePct ? to.sdOverridePct : p.sdOverridePct,
    mdCutPct: p.mdCutPct === from.mdCutPct ? to.mdCutPct : p.mdCutPct,
    externalCompanyRetainedPct: p.externalCompanyRetainedPct === from.externalCompanyRetainedPct ? to.externalCompanyRetainedPct : p.externalCompanyRetainedPct,
  };
}

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
    mdCutPct: mdCutDefaultFor("10"),
    companyCutType: "Percentage", smOverrideType: "Percentage", sdOverrideType: "Percentage", mdCutType: "Percentage",
    isExternal: false, effectiveDate: today, defaultCompanyId: companies[0]?.id,
  });
  const set = (patch: Partial<ProductInput>) =>
    setF((p) => {
      // Keep the MD cut tracking 30% of the company cut WHILE it is still
      // whatever that rule produced — i.e. until the admin types their own
      // figure, after which it stops moving. Same principle as the pristine
      // swap below: a value the admin chose is never overwritten.
      if (patch.companyCutPct !== undefined && patch.companyCutPct !== p.companyCutPct) {
        const untouched = (p.mdCutPct ?? "") === mdCutDefaultFor(p.companyCutPct);
        if (untouched) patch = { ...patch, mdCutPct: mdCutDefaultFor(patch.companyCutPct) };
      }
      if (patch.isExternal === undefined || patch.isExternal === p.isExternal) return { ...p, ...patch };
      const from = p.isExternal ? PRISTINE_EXTERNAL : PRISTINE_INTERNAL;
      const to = patch.isExternal ? PRISTINE_EXTERNAL : PRISTINE_INTERNAL;
      return { ...p, ...swapPristineRates(p, from, to), ...patch };
    });
  const [pricing, setPricing] = useState<PricingValue>(emptyPricing);
  const setPricingPatch = (patch: Partial<PricingValue>) => setPricing((p) => ({ ...p, ...patch }));

  const pricingIncomplete =
    !pricing.listedPrice ||
    (pricing.instalmentPlans.length > 0 && !pricing.bookingFee) ||
    pricing.instalmentPlans.some((p) => !p.months);

  const orUndef = (s: string) => (s.trim() === "" ? undefined : s);

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await createProduct({
        ...f,
        listedPrice: pricing.listedPrice,
        discountedPrice: orUndef(pricing.discountedPrice),
        closingBasis: pricing.closingBasis,
        bookingFee: orUndef(pricing.bookingFee),
        instalmentPlans: pricing.instalmentPlans.map((p) => ({ months: Number(p.months) })),
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
