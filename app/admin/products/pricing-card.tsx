"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { sanitizeAmountInput } from "@/lib/numeric";
import { closingPrice, deriveInstalmentSchedule, formatSGD } from "@/lib/money";

// Mirrors the Prisma `ClosingBasis` enum (lib/schemas.ts productPricingShape)
// — which price commission/upline comm are calculated on.
export type ClosingBasis = "ListedPrice" | "DiscountedPrice";

/** One instalment add-on row. Just the admin-typed month count — the
 *  monthly amount is never part of this value (owner's ruling, 2026-10-09
 *  follow-up, "no override allowed"): it is derived fresh at render time
 *  from (closing price, booking fee, months) via lib/money.ts
 *  deriveInstalmentSchedule, so there is nothing here to type, store, or
 *  go stale against a later price edit. */
export type InstalmentPlanValue = { months: string };

export type PricingValue = {
  listedPrice: string;
  discountedPrice: string;
  closingBasis: ClosingBasis;
  bookingFee: string;
  instalmentPlans: InstalmentPlanValue[];
};

export const emptyPricing: PricingValue = {
  listedPrice: "",
  discountedPrice: "",
  closingBasis: "ListedPrice",
  bookingFee: "",
  instalmentPlans: [],
};

function validNumber(s: string): boolean {
  return s.trim() !== "" && !Number.isNaN(Number(s));
}

function validMonths(s: string): boolean {
  return /^[1-9]\d*$/.test(s.trim());
}

/** The derived monthly amount, read-only — never an input. Shows the exact
 *  derivation ("$1,000.00 − $0.00 booking fee ÷ 12 months") and, whenever
 *  the final instalment differs from the regular one (almost always, since
 *  it absorbs the rounding remainder), an explicit final-instalment line
 *  ("11 × $83.33, final $83.37") rather than a single figure that silently
 *  understates the true last payment. */
function DerivedInstalmentAmount({ closingPriceStr, bookingFee, months }: { closingPriceStr: string | null; bookingFee: string; months: string }) {
  const t = useTranslations("products");
  if (!validMonths(months)) {
    return <p className="mt-1 text-[12px] text-muted-2">{t("instalmentEnterMonths")}</p>;
  }
  if (closingPriceStr === null) return null;
  const monthsNum = Number(months);
  // Blank booking fee reads as zero everywhere (the owner's ruling) — the
  // common case, and the thing the prior, override-based UI got wrong.
  const feeStr = validNumber(bookingFee) ? bookingFee : "0";
  const schedule = deriveInstalmentSchedule(closingPriceStr, feeStr, monthsNum);
  if (schedule === null) {
    return <p className="mt-1 text-[12px] text-danger">{t("instalmentFeeExceedsPrice")}</p>;
  }
  const { regular, final } = schedule;
  return (
    <div className="mt-1">
      <p className="text-[14px] font-medium text-ink">{formatSGD(regular)}</p>
      <p className="text-[12px] text-muted-2">
        {t("instalmentDerivationLine", { closing: formatSGD(closingPriceStr), fee: formatSGD(feeStr), months: monthsNum })}
      </p>
      {!regular.equals(final) && monthsNum > 1 && (
        <p className="text-[12px] text-muted-2">{t("instalmentFinalLine", { count: monthsNum - 1, regular: formatSGD(regular), final: formatSGD(final) })}</p>
      )}
    </div>
  );
}

/**
 * Pricing fields only (listed/discounted price, instalment plans) — no
 * commission, code or effective-date fields, those stay on their own forms.
 * Self-contained on `value`/`onChange` so the same component drives both the
 * new-product form and the pricing-only edit page, prefilled either way.
 *
 * Instalments (owner's change, 2026-10-09): a repeatable add-on list, not a
 * fixed 12/24-month choice. Full payment is always available and needs no
 * row here — it's simply what an empty list means. The monthly amount is
 * pure display (2026-10-09 follow-up) — see DerivedInstalmentAmount above.
 */
export function PricingCard({ value, onChange }: { value: PricingValue; onChange: (patch: Partial<PricingValue>) => void }) {
  const t = useTranslations("products");
  const set = (patch: Partial<PricingValue>) => onChange(patch);

  const discountExceeds =
    validNumber(value.listedPrice) && validNumber(value.discountedPrice) && Number(value.discountedPrice) > Number(value.listedPrice);

  const closingPriceStr =
    validNumber(value.listedPrice) && !discountExceeds
      ? closingPrice(value.listedPrice, validNumber(value.discountedPrice) ? value.discountedPrice : null, value.closingBasis).toFixed(2)
      : null;

  const setPlan = (i: number, patch: Partial<InstalmentPlanValue>) => {
    const plans = value.instalmentPlans.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    set({ instalmentPlans: plans });
  };
  const addPlan = () => set({ instalmentPlans: [...value.instalmentPlans, { months: "" }] });
  const removePlan = (i: number) => set({ instalmentPlans: value.instalmentPlans.filter((_, idx) => idx !== i) });

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-display text-[17px] text-ink">{t("pricingHeading")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="listedPrice">{t("listedPriceLabel")}</Label>
          <Input
            id="listedPrice"
            inputMode="decimal"
            value={value.listedPrice}
            onChange={(e) => set({ listedPrice: sanitizeAmountInput(e.target.value) })}
            placeholder="5000.00"
          />
        </div>
        <div>
          <Label htmlFor="discountedPrice">{t("discountedPriceLabel")}</Label>
          <Input
            id="discountedPrice"
            inputMode="decimal"
            value={value.discountedPrice}
            onChange={(e) => {
              const discountedPrice = sanitizeAmountInput(e.target.value);
              // Clearing the discount while the basis is DiscountedPrice would
              // hit the server's rejection on a normal edit — switch back to
              // Listed here so that path is never reached (owner ruling).
              const closingBasis = discountedPrice.trim() === "" && value.closingBasis === "DiscountedPrice" ? "ListedPrice" : value.closingBasis;
              set({ discountedPrice, closingBasis });
            }}
            placeholder="4500.00"
          />
          {discountExceeds && <p className="mt-1 text-[12px] text-danger">{t("discountedPriceExceedsListed")}</p>}
        </div>
        <div>
          <Label htmlFor="closingBasis">{t("closingBasisLabel")}</Label>
          <select
            id="closingBasis"
            className="h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none"
            value={value.closingBasis}
            onChange={(e) => set({ closingBasis: e.target.value as ClosingBasis })}
          >
            <option value="ListedPrice">{t("closingBasisListed")}</option>
            <option value="DiscountedPrice" disabled={!validNumber(value.discountedPrice)}>
              {t("closingBasisDiscounted")}
            </option>
          </select>
        </div>
        {value.instalmentPlans.length > 0 && (
          <div>
            <Label htmlFor="bookingFee">{t("bookingFeeLabel")}</Label>
            <Input
              id="bookingFee"
              inputMode="decimal"
              value={value.bookingFee}
              onChange={(e) => set({ bookingFee: sanitizeAmountInput(e.target.value) })}
              placeholder="200.00"
            />
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-line bg-paper-50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-ink">{t("instalmentPlansHeading")}</h3>
          <Button type="button" variant="secondary" size="sm" onClick={addPlan}>
            {t("addInstalmentPlanBtn")}
          </Button>
        </div>
        {value.instalmentPlans.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">{t("noInstalmentPlans")}</p>
        ) : (
          <div className="mt-3 space-y-3">
            {value.instalmentPlans.map((plan, i) => (
              <div key={i} className="flex flex-wrap items-start gap-3 rounded-md border border-line bg-white p-3">
                <div>
                  <Label htmlFor={`plan-months-${i}`}>{t("instalmentMonthsLabel")}</Label>
                  <Input
                    id={`plan-months-${i}`}
                    inputMode="numeric"
                    value={plan.months}
                    onChange={(e) => setPlan(i, { months: e.target.value.replace(/[^\d]/g, "") })}
                    placeholder="12"
                    className="w-24"
                  />
                </div>
                <div>
                  {/* Pure display, never an input — the owner's ruling leaves
                      no override here, so there is nothing to type: no
                      placeholder, no cursor, nothing that reads as a question. */}
                  <Label>{t("monthlyInstalmentLabel")}</Label>
                  <DerivedInstalmentAmount closingPriceStr={closingPriceStr} bookingFee={value.bookingFee} months={plan.months} />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => removePlan(i)}>
                  {t("removeInstalmentPlanBtn")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
