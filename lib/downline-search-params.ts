// Deliberately NOT a "use client" module -- same reason as
// lib/team-search-params.ts: this key is read by Server Components from
// `searchParams`, and a constant exported from a "use client" module turns
// into an opaque client reference there, silently no-opping the filter.
// The client select and the server pages both import it from here.
export const DOWNLINE_FILTER_KEY = "downline";

/** `direct` = the viewer plus their direct recruits (one level only). */
export const DOWNLINE_DIRECT = "direct";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DownlineFilterInput = { kind: "direct" } | { kind: "one"; id: string };

/** Decodes the raw URL param. Absent or malformed input is null, never an error. */
export function parseDownlineParam(raw: string | string[] | undefined): DownlineFilterInput | null {
  if (typeof raw !== "string" || !raw) return null;
  if (raw === DOWNLINE_DIRECT) return { kind: "direct" };
  if (UUID_RE.test(raw)) return { kind: "one", id: raw.toLowerCase() };
  return null;
}

/**
 * Resolves the filter to an associate-id allowlist, or null for "no filter".
 * The candidate is NOT trusted: a single id is honoured only if it is the
 * viewer or one of their DIRECT recruits (`directIds`, computed server-side);
 * anything else resolves to null, indistinguishable from "no filter", so a
 * hand-edited id cannot be used to probe. The result is then intersected with
 * the viewer's existing visibility `scope` (null = unrestricted), so the
 * filter can only ever narrow what the viewer could already see.
 */
export function resolveDownlineFilter(
  me: string | null,
  input: DownlineFilterInput | null,
  directIds: string[],
  scope: string[] | null,
): string[] | null {
  if (!me || !input) return null;
  const allowed = new Set([me, ...directIds].map((s) => s.toLowerCase()));
  let ids: string[];
  if (input.kind === "direct") ids = [...allowed];
  else if (allowed.has(input.id)) ids = [input.id];
  else return null;
  if (scope === null) return ids;
  const s = new Set(scope.map((x) => x.toLowerCase()));
  return ids.filter((id) => s.has(id));
}
