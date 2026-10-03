"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
// The key and the "direct" value live in a plain (non-"use client") module and
// are NOT re-exported from here: Server Components must import them from
// lib/downline-search-params.ts directly (RSC client-reference hazard).
import { DOWNLINE_DIRECT, DOWNLINE_FILTER_KEY } from "@/lib/downline-search-params";

const selectCls =
  "h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus:border-action focus:outline-none";

/**
 * Downline search for the My Transactions tabs. Options are built server-side
 * from the viewer's own direct recruits, but the server re-validates whatever
 * actually arrives in the URL (see resolveDownlineFilter).
 */
export function DownlineFilter({
  me,
  recruits,
  label,
  allLabel,
  directLabel,
  selfLabel,
  recruitGroupLabel,
}: {
  me: string;
  recruits: { id: string; label: string }[];
  label: string;
  allLabel: string;
  directLabel: string;
  selfLabel: string;
  recruitGroupLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(DOWNLINE_FILTER_KEY) ?? "";

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(DOWNLINE_FILTER_KEY, value);
    else params.delete(DOWNLINE_FILTER_KEY);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  if (recruits.length === 0) return null;

  return (
    <select aria-label={label} className={selectCls} value={current} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allLabel}</option>
      <option value={DOWNLINE_DIRECT}>{directLabel}</option>
      <option value={me}>{selfLabel}</option>
      <optgroup label={recruitGroupLabel}>
        {recruits.map((r) => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </optgroup>
    </select>
  );
}
