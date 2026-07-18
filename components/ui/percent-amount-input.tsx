"use client";

import { Input } from "@/components/ui/input";
import { sanitizeAmountInput } from "@/lib/numeric";

export type AmountValueType = "Percentage" | "Absolute";

/**
 * Global Rule 1 (16-Jul) shared control: a value entered as a percentage OR an
 * absolute amount, to at most 2 decimal places. When a `base` is given and the
 * mode is Percentage, the $ equivalent is shown beside it (e.g. 10% of $10,000
 * = $1,000).
 */
export function PercentAmountInput({
  value,
  valueType,
  onValueChange,
  onTypeChange,
  base,
  id,
  placeholder,
  disabled,
}: {
  value: string;
  valueType: AmountValueType;
  onValueChange: (v: string) => void;
  onTypeChange: (t: AmountValueType) => void;
  /** Sales amount, used only to show the $ equivalent when mode is Percentage. */
  base?: number;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const num = Number(value);
  const preview =
    valueType === "Percentage" && base != null && value !== "" && !Number.isNaN(num)
      ? (base * num) / 100
      : null;

  return (
    <div className="flex items-stretch gap-1">
      <Input
        id={id}
        value={value}
        onChange={(e) => onValueChange(sanitizeAmountInput(e.target.value))}
        placeholder={placeholder}
        inputMode="decimal"
        disabled={disabled}
        className="min-w-0 flex-1"
      />
      <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-line" role="group" aria-label="value type">
        {(["Percentage", "Absolute"] as AmountValueType[]).map((tp) => (
          <button
            key={tp}
            type="button"
            disabled={disabled}
            onClick={() => onTypeChange(tp)}
            aria-pressed={valueType === tp}
            className={
              "px-2.5 text-sm disabled:opacity-50 " +
              (valueType === tp ? "bg-action text-white" : "bg-white text-muted hover:bg-paper-100")
            }
          >
            {tp === "Percentage" ? "%" : "$"}
          </button>
        ))}
      </div>
      {preview !== null && (
        <span className="flex shrink-0 items-center whitespace-nowrap px-1 text-[12px] text-muted-2">
          = ${preview.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
    </div>
  );
}
