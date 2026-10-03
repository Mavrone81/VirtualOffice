"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
// TEAM_SEARCH_KEY lives in lib/team-search-params.ts, a plain (non-"use
// client") module, and is NOT re-exported from here -- a Server Component
// page must import it from there directly, never through this file, or the
// RSC client-boundary hazard this file's own history documents reappears.
import { TEAM_SEARCH_KEY } from "@/lib/team-search-params";

const selectCls =
  "h-9 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus:border-action focus:outline-none";

/**
 * "Search by individual or team" — a single dropdown over two option
 * groups. The VALUE is only ever one of the ids this associate's own server
 * render already put in the list (built from their own scope, same as the
 * server-side validation in lib/team.ts's resolveTeamSearchScope), but the
 * server still re-validates whatever actually arrives, since a URL param
 * can be edited by hand regardless of what this control renders.
 */
export function TeamSearchFilter({
  individuals,
  teams,
  allLabel,
  individualGroupLabel,
  teamGroupLabel,
}: {
  individuals: { id: string; label: string }[];
  teams: { id: string; label: string }[];
  allLabel: string;
  individualGroupLabel: string;
  teamGroupLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(TEAM_SEARCH_KEY) ?? "";

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(TEAM_SEARCH_KEY, value);
    else params.delete(TEAM_SEARCH_KEY);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  if (individuals.length === 0 && teams.length === 0) return null;

  return (
    <select aria-label={allLabel} className={selectCls} value={current} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allLabel}</option>
      {individuals.length > 0 && (
        <optgroup label={individualGroupLabel}>
          {individuals.map((i) => (
            <option key={i.id} value={`ind:${i.id}`}>{i.label}</option>
          ))}
        </optgroup>
      )}
      {teams.length > 0 && (
        <optgroup label={teamGroupLabel}>
          {teams.map((t) => (
            <option key={t.id} value={`team:${t.id}`}>{t.label}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
