"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { sanitizeAmountInput } from "@/lib/numeric";
import { D, effectivePrice, instalmentTotal, formatSGD } from "@/lib/money";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export type InstalmentOption = "None" | "Months12" | "Months12or24";

// Mirrors the Prisma `ClosingBasis` enum (lib/schemas.ts productPricingShape)
// — which price commission/upline comm are calculated on.
export type ClosingBasis = "ListedPrice" | "DiscountedPrice";

export type PricingValue = {
  listedPrice: string;
  discountedPrice: string;
  closingBasis: ClosingBasis;
  instalmentOption: InstalmentOption;
  bookingFee: string;
  monthlyInstalment12: string;
  monthlyInstalment24: string;
};

export const emptyPricing: PricingValue = {
  listedPrice: "",
  discountedPrice: "",
  closingBasis: "ListedPrice",
  instalmentOption: "None",
  bookingFee: "",
  monthlyInstalment12: "",
  monthlyInstalment24: "",
};

function validNumber(s: string): boolean {
  return s.trim() !== "" && !Number.isNaN(Number(s));
}

// One term of the non-blocking hint (2026-09-30): the total a buyer pays
// across the plan vs. the effective price they're actually buying at. The shared
// money helper does every bit of the arithmetic — this only formats it.
function InstalmentHint({ label, bookingFee, monthly, months, effective }: { label: string; bookingFee: string; monthly: string; months: number; effective: string }) {
  if (!validNumber(bookingFee) || !validNumber(monthly)) return null;
  const total = instalmentTotal(bookingFee, monthly, months);
  return (
    <p className="text-[12px] text-muted-2">
      {label}: {formatSGD(total)} vs {formatSGD(D(effective))}
    </p>
  );
}

/**
 * Pricing fields only (listed/discounted price, instalment plan) — no
 * commission, code or effective-date fields, those stay on their own forms.
 * Self-contained on `value`/`onChange` so the same component drives both the
 * new-product form and the pricing-only edit page, prefilled either way.
 */
export function PricingCard({ value, onChange }: { value: PricingValue; onChange: (patch: Partial<PricingValue>) => void }) {
  const t = useTranslations("products");
  const set = (patch: Partial<PricingValue>) => onChange(patch);

  const discountExceeds =
    validNumber(value.listedPrice) && validNumber(value.discountedPrice) && Number(value.discountedPrice) > Number(value.listedPrice);

  const needsInstalment = value.instalmentOption !== "None";
  const needsBothMonths = value.instalmentOption === "Months12or24";
  // Suppress the hint entirely while the discount is invalid — showing a
  // total "vs" an effective price computed from a value we're simultaneously
  // flagging as too high would just add a second, contradictory number.
  const effective =
    validNumber(value.listedPrice) && !discountExceeds
      ? effectivePrice(value.listedPrice, validNumber(value.discountedPrice) ? value.discountedPrice : null).toFixed(2)
      : null;

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
            className={selectCls}
            value={value.closingBasis}
            onChange={(e) => set({ closingBasis: e.target.value as ClosingBasis })}
          >
            <option value="ListedPrice">{t("closingBasisListed")}</option>
            <option value="DiscountedPrice" disabled={!validNumber(value.discountedPrice)}>
              {t("closingBasisDiscounted")}
            </option>
          </select>
        </div>
        <div>
          <Label htmlFor="instalmentOption">{t("instalmentOptionLabel")}</Label>
          <select
            id="instalmentOption"
            className={selectCls}
            value={value.instalmentOption}
            onChange={(e) => set({ instalmentOption: e.target.value as InstalmentOption })}
          >
            <option value="None">{t("instalmentNone")}</option>
            <option value="Months12">{t("instalment12Months")}</option>
            <option value="Months12or24">{t("instalmentBuyerChoice")}</option>
          </select>
        </div>
      </div>

      {needsInstalment && (
        <div className="mt-4 rounded-lg border border-line bg-paper-50 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
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
            <div>
              <Label htmlFor="monthlyInstalment12">
                {needsBothMonths ? t("monthlyInstalment12Label") : t("monthlyInstalmentLabel")}
              </Label>
              <Input
                id="monthlyInstalment12"
                inputMode="decimal"
                value={value.monthlyInstalment12}
                onChange={(e) => set({ monthlyInstalment12: sanitizeAmountInput(e.target.value) })}
                placeholder="400.00"
              />
            </div>
            {needsBothMonths && (
              <div>
                <Label htmlFor="monthlyInstalment24">{t("monthlyInstalment24Label")}</Label>
                <Input
                  id="monthlyInstalment24"
                  inputMode="decimal"
                  value={value.monthlyInstalment24}
                  onChange={(e) => set({ monthlyInstalment24: sanitizeAmountInput(e.target.value) })}
                  placeholder="220.00"
                />
              </div>
            )}
          </div>

          {effective && (
            <div className="mt-3 space-y-0.5">
              <InstalmentHint
                label={needsBothMonths ? t("hint12Months") : t("hintPlanTotal")}
                bookingFee={value.bookingFee}
                monthly={value.monthlyInstalment12}
                months={12}
                effective={effective}
              />
              {needsBothMonths && (
                <InstalmentHint
                  label={t("hint24Months")}
                  bookingFee={value.bookingFee}
                  monthly={value.monthlyInstalment24}
                  months={24}
                  effective={effective}
                />
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
