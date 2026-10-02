"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Keys are prefixed `mo` (My Overrides) so they can never collide with any
// other filter param this page, or a future one, adds (e.g. a search param
// from the held C-11 work).
export const MY_OVERRIDES_VIEW_KEY = "moView";
export const MY_OVERRIDES_MONTH_KEY = "moMonth";
export const MY_OVERRIDES_YEAR_KEY = "moYear";

export type MyOverridesView = "overall" | "received";

// Zero-padded numeric months ("01".."12") rather than English month names —
// this component has no locale context of its own, and the rest of this
// page already displays payoutMonth as a raw "YYYY-MM" string (the ledger
// table's Month column), so this matches an existing convention instead of
// introducing an unlocalized English string into a bilingual app.
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

const selectCls =
  "h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus:border-action focus:outline-none";

export function MyOverridesControls({
  view,
  month,
  year,
  yearOptions,
  labels,
}: {
  view: MyOverridesView;
  month: number; // 1-12
  year: number;
  yearOptions: number[];
  labels: { overall: string; received: string; month: string; year: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) params.set(k, v);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
        {(["overall", "received"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setParams({ [MY_OVERRIDES_VIEW_KEY]: v })}
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              view === v ? "bg-ink text-white" : "text-muted hover:text-ink"
            }`}
          >
            {v === "overall" ? labels.overall : labels.received}
          </button>
        ))}
      </div>

      <select
        aria-label={labels.month}
        className={selectCls}
        value={String(month)}
        onChange={(e) => setParams({ [MY_OVERRIDES_MONTH_KEY]: e.target.value })}
      >
        {MONTHS.map((label, i) => (
          <option key={label} value={String(i + 1)}>{label}</option>
        ))}
      </select>

      <select
        aria-label={labels.year}
        className={selectCls}
        value={String(year)}
        onChange={(e) => setParams({ [MY_OVERRIDES_YEAR_KEY]: e.target.value })}
      >
        {yearOptions.map((y) => (
          <option key={y} value={String(y)}>{y}</option>
        ))}
      </select>
    </div>
  );
}
