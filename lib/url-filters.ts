import { isValid, parseISO } from "date-fns";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shared primitives for validating raw URL searchParams before they reach
 * Prisma. A filter link is user-editable and gets shared/bookmarked, so a
 * hand-edited or stale value must degrade to "that filter is ignored", never
 * a 500 (a non-UUID reaching a `::uuid` cast throws Prisma P2023).
 */
export function parseEnum<T extends string>(values: readonly T[], v: string | undefined): T | undefined {
  return v !== undefined && (values as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function parseUuid(v: string | undefined): string | undefined {
  return v !== undefined && UUID_RE.test(v) ? v : undefined;
}

/**
 * A URL date param as UTC midnight, matching `@db.Date`/timestamp semantics
 * regardless of the server's local timezone. date-fns' parseISO + isValid
 * catches invalid calendar dates that a plain `new Date("2026-02-30")` would
 * silently roll over to March 2 instead of rejecting.
 */
export function parseDateOnly(v: string | undefined): Date | undefined {
  if (v === undefined || !DATE_ONLY_RE.test(v) || !isValid(parseISO(v))) return undefined;
  return new Date(`${v}T00:00:00.000Z`);
}

/** `to` as an exclusive upper bound: the UTC midnight starting the day after. */
export function parseDateOnlyExclusiveEnd(v: string | undefined): Date | undefined {
  const d = parseDateOnly(v);
  return d ? new Date(d.getTime() + DAY_MS) : undefined;
}
