import { Prisma } from "@prisma/client";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { VERSION_RESOLUTION_ORDER } from "@/server/commission/version-order";
import type { RateSnapshot } from "@/server/commission/inputs";

// DISPLAY readers (portal catalogue, admin list, admin commission breakdown)
// must show the rates IN FORCE NOW, not the product row's commission columns.
// The columns are a mirror of the LATEST rate version, so a version dated in the
// future would otherwise show before it takes effect — and an associate quoting
// from the portal would quote a rate the engine will not pay. These helpers
// resolve the newest version with effectiveDate <= today (same ordering the
// engine's resolution sites use) and overlay its snapshot on the row.
//
// A product with NO version in force yet (legacy row, or every version still in
// the future) keeps its own columns: there is nothing earlier to show.

type Db = Pick<typeof prisma, "commissionStructureVersion">;

/** Today as a date, in the app's day (see earliestRateChangeDate). */
export const todayDate = (now: Date = new Date()) => new Date(format(now, "yyyy-MM-dd"));

type InForce = { snapshot: RateSnapshot; effectiveDate: Date };

/** The version in force today, per product code. */
export async function loadRatesInForce(productCodes: string[], now: Date = new Date(), db: Db = prisma): Promise<Map<string, InForce>> {
  const out = new Map<string, InForce>();
  if (productCodes.length === 0) return out;
  const versions = await db.commissionStructureVersion.findMany({
    where: { productCode: { in: productCodes }, effectiveDate: { lte: todayDate(now) } },
    orderBy: [{ productCode: "asc" }, ...VERSION_RESOLUTION_ORDER],
    select: { productCode: true, effectiveDate: true, rateSnapshot: true },
  });
  for (const v of versions) {
    if (!out.has(v.productCode)) out.set(v.productCode, { snapshot: v.rateSnapshot as unknown as RateSnapshot, effectiveDate: v.effectiveDate });
  }
  return out;
}

const dec = (v: string | null | undefined) => (v == null ? null : new Prisma.Decimal(v));

/** The row with its commission fields replaced by the version in force. Only
 *  keys the row already carries are touched (a narrow select stays narrow), and
 *  unset type fields default to Percentage exactly as the engine's toLineInput does. */
export function withRatesInForce<T extends { productCode: string }>(row: T, inForce: InForce | undefined): T {
  if (!inForce) return row;
  const rs = inForce.snapshot;
  const next: Record<string, unknown> = {
    // A snapshot written without these keys falls back to the row's own value.
    commissionType: rs.commissionType ?? (row as Record<string, unknown>).commissionType,
    closingCommPct: dec(rs.closingCommPct),
    closingCommFixed: dec(rs.closingCommFixed),
    companyCutPct: dec(rs.companyCutPct ?? "0"),
    companyCutType: rs.companyCutType ?? "Percentage",
    smOverridePct: dec(rs.smOverridePct ?? "0"),
    smOverrideType: rs.smOverrideType ?? "Percentage",
    sdOverridePct: dec(rs.sdOverridePct ?? "0"),
    sdOverrideType: rs.sdOverrideType ?? "Percentage",
    isExternal: rs.isExternal ?? (row as Record<string, unknown>).isExternal,
    externalCompanyRetainedPct: dec(rs.externalCompanyRetainedPct),
    effectiveDate: inForce.effectiveDate,
  };
  const out: Record<string, unknown> = { ...row };
  for (const k of Object.keys(next)) if (k in row) out[k] = next[k];
  return out as T;
}

/** Overlay the version in force onto a list of product rows (one query for all). */
export async function withCurrentRates<T extends { productCode: string }>(rows: T[], now: Date = new Date(), db: Db = prisma): Promise<T[]> {
  const inForce = await loadRatesInForce([...new Set(rows.map((r) => r.productCode))], now, db);
  return rows.map((r) => withRatesInForce(r, inForce.get(r.productCode)));
}

/** The NEXT scheduled rate change per product code: the earliest version dated
 *  after today (the newest one if several share that date). Used by the admin
 *  list so a change scheduled for later does not look like it failed to save,
 *  while the list itself keeps showing the rates in force. */
export async function loadPendingRateChanges(productCodes: string[], now: Date = new Date(), db: Db = prisma): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (productCodes.length === 0) return out;
  const versions = await db.commissionStructureVersion.findMany({
    where: { productCode: { in: productCodes }, effectiveDate: { gt: todayDate(now) } },
    orderBy: [{ productCode: "asc" }, { effectiveDate: "asc" }, { createdAt: "desc" }],
    select: { productCode: true, effectiveDate: true },
  });
  for (const v of versions) if (!out.has(v.productCode)) out.set(v.productCode, v.effectiveDate);
  return out;
}
