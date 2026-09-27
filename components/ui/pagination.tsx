"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * B-2's Prev/Next pager — no numbered-page pattern exists yet in this
 * codebase, so a simple pager + result count ("Showing X–Y of Z") is the
 * default per the design spec. `page` lives in the URL alongside the other
 * FilterBar params (1-based; omitted from the URL on page 1).
 */
export function Pagination({
  page, pageSize, total, showingLabel, prevLabel, nextLabel,
}: {
  page: number; pageSize: number; total: number; showingLabel: string; prevLabel: string; nextLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (total === 0) return null;

  const to = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = to < total;

  function goTo(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) params.delete("page");
    else params.set("page", String(p));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mt-4 flex items-center justify-between text-[12px] text-muted">
      <span>{showingLabel}</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => goTo(page - 1)} disabled={!hasPrev}
          className="rounded-lg border border-line px-3 py-1.5 text-ink hover:bg-paper-100 disabled:opacity-40 disabled:hover:bg-transparent">
          {prevLabel}
        </button>
        <button type="button" onClick={() => goTo(page + 1)} disabled={!hasNext}
          className="rounded-lg border border-line px-3 py-1.5 text-ink hover:bg-paper-100 disabled:opacity-40 disabled:hover:bg-transparent">
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
