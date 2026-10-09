"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { sanitizeAmountInput } from "@/lib/numeric";
import { D, closingPrice, instalmentTotal, formatSGD } from "@/lib/money";

// Mirrors the Prisma `ClosingBasis` enum (lib/schemas.ts productPricingShape)
// — which price commission/upline comm are calculated on.
export type ClosingBasis = "ListedPrice" | "DiscountedPrice";

/** One instalment add-on row. `touched` is local UI state only (never sent
 *  to the server, never persisted) — it just tracks whether THIS SESSION's
 *  admin has typed their own monthlyAmount, so recomputing stops for that
 *  row until it's removed and re-added. A row loaded from an existing
 *  product always starts touched (see edit-pricing-form.tsx /
 *  edit-product-form.tsx): there is no stored flag to tell whether a saved
 *  amount was ever auto-computed or chosen, so opening an edit screen must
 *  never silently recompute over a figure someone already saved. */
export type InstalmentPlanValue = { months: string; monthlyAmount: string; touched: boolean };

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

/** Recomputes every UNTOUCHED row's monthlyAmount from the current closing
 *  price / booking fee / that row's own months — the one place this
 *  arithmetic happens, called after every change that could affect it.
 *  Mirrors the sale side's own schedule math (server/sales/actions.ts):
 *  round2((closing price − booking fee) / months). A touched row, or a row
 *  whose months isn't a valid positive integer yet, is left exactly as is. */
function recomputePlans(plans: InstalmentPlanValue[], closingPriceStr: string | null, bookingFee: string): InstalmentPlanValue[] {
  if (closingPriceStr === null || !validNumber(bookingFee)) return plans;
  const basis = D(closingPriceStr).sub(D(bookingFee));
  return plans.map((p) => {
    if (p.touched || !validMonths(p.months)) return p;
    const monthlyAmount = basis.div(Number(p.months)).toDecimalPlaces(2).toFixed(2);
    return { ...p, monthlyAmount };
  });
}

// One term of the non-blocking hint (2026-09-30): the total a buyer pays
// across the plan vs. the effective price they're actually buying at. The shared
// money helper does every bit of the arithmetic — this only formats it.
function InstalmentHint({ bookingFee, monthly, months, effective }: { bookingFee: string; monthly: string; months: number; effective: string }) {
  const t = useTranslations("products");
  if (!validNumber(bookingFee) || !validNumber(monthly)) return null;
  const total = instalmentTotal(bookingFee, monthly, months);
  return (
    <p className="text-[12px] text-muted-2">
      {t("hintPlanTotal", { months })}: {formatSGD(total)} vs {formatSGD(D(effective))}
    </p>
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
 * row here — it's simply what an empty list means.
 */
export function PricingCard({ value, onChange }: { value: PricingValue; onChange: (patch: Partial<PricingValue>) => void }) {
  const t = useTranslations("products");
  const set = (patch: Partial<PricingValue>) => onChange(patch);

  const discountExceeds =
    validNumber(value.listedPrice) && validNumber(value.discountedPrice) && Number(value.discountedPrice) > Number(value.listedPrice);

  // Suppress the hint entirely while the discount is invalid — showing a
  // total "vs" an effective price computed from a value we're simultaneously
  // flagging as too high would just add a second, contradictory number.
  const effective =
    validNumber(value.listedPrice) && !discountExceeds
      ? (validNumber(value.discountedPrice) ? D(value.discountedPrice) : D(value.listedPrice)).toFixed(2)
      : null;
  // Recompute every untouched row whenever a dependency changes, at the
  // point of that specific change — not a blanket effect watching
  // everything, which would risk firing on its own output.
  const withRecompute = (patch: Partial<PricingValue>): Partial<PricingValue> => {
    const next = { ...value, ...patch };
    const nextClosingPrice =
      validNumber(next.listedPrice) && !(validNumber(next.discountedPrice) && Number(next.discountedPrice) > Number(next.listedPrice))
        ? closingPrice(next.listedPrice, validNumber(next.discountedPrice) ? next.discountedPrice : null, next.closingBasis).toFixed(2)
        : null;
    return { ...patch, instalmentPlans: recomputePlans(next.instalmentPlans, nextClosingPrice, next.bookingFee) };
  };

  const setPlan = (i: number, patch: Partial<InstalmentPlanValue>) => {
    const plans = value.instalmentPlans.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    set(withRecompute({ instalmentPlans: plans }));
  };
  const addPlan = () => set({ instalmentPlans: [...value.instalmentPlans, { months: "", monthlyAmount: "", touched: false }] });
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
            onChange={(e) => set(withRecompute({ listedPrice: sanitizeAmountInput(e.target.value) }))}
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
              set(withRecompute({ discountedPrice, closingBasis }));
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
            onChange={(e) => set(withRecompute({ closingBasis: e.target.value as ClosingBasis }))}
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
              onChange={(e) => set(withRecompute({ bookingFee: sanitizeAmountInput(e.target.value) }))}
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
              <div key={i} className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-white p-3">
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
                  <Label htmlFor={`plan-amount-${i}`}>{t("monthlyInstalmentLabel")}</Label>
                  <Input
                    id={`plan-amount-${i}`}
                    inputMode="decimal"
                    value={plan.monthlyAmount}
                    onChange={(e) => setPlan(i, { monthlyAmount: sanitizeAmountInput(e.target.value), touched: true })}
                    placeholder="400.00"
                    className="w-32"
                  />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => removePlan(i)}>
                  {t("removeInstalmentPlanBtn")}
                </Button>
                {effective && (
                  <InstalmentHint bookingFee={value.bookingFee} monthly={plan.monthlyAmount} months={Number(plan.months) || 0} effective={effective} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
