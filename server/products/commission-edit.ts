import type { Prisma } from "@prisma/client";
import { addDays, format } from "date-fns";
import { D } from "@/lib/money";

// Pure helpers for editing a product's commission structure (no DB, no
// "use server" — a server-actions file may only export async functions).
//
// A product's commission columns are a CURRENT-VALUES MIRROR. What the engine
// pays from is the CommissionStructureVersion a sale line was resolved to at
// verify time (server/sales/actions.ts, by sales date). So a commission edit
// is only real if it also writes a new version — these helpers decide whether
// an edit touched the commission structure at all, and what exactly changed.

/** Canonical, comparable form of the 12 commission-structure fields: decimals
 *  as fixed-scale strings (so "10" and "10.0000" compare equal, matching what
 *  the DB column reads back), enums defaulted exactly as createProduct
 *  defaults them, effective date as yyyy-mm-dd. */
export type CanonicalCommission = {
  commissionType: "Percentage" | "Fixed";
  closingCommPct: string | null;
  closingCommFixed: string | null;
  companyCutPct: string;
  companyCutType: "Percentage" | "Absolute";
  smOverridePct: string;
  smOverrideType: "Percentage" | "Absolute";
  sdOverridePct: string;
  sdOverrideType: "Percentage" | "Absolute";
  // Managing Director's cut (2026-10-07). It belongs in this canonical
  // form for the same reason every other rate does: this type decides
  // whether an edit wrote a NEW commission version. Left out, changing ONLY
  // the MD cut would compare equal to the stored row, no version would be
  // written, and the engine — which pays from the version, not from the
  // product row — would keep using the old rate while the product screen
  // showed the new one.
  mdCutPct: string;
  mdCutType: "Percentage" | "Absolute";
  isExternal: boolean;
  externalCompanyRetainedPct: string | null;
  externalCompanyRetainedType: "Percentage" | "Absolute";
  effectiveDate: string;
};

type CommissionInput = {
  commissionType: "Percentage" | "Fixed";
  closingCommPct?: string;
  closingCommFixed?: string;
  companyCutPct: string;
  companyCutType?: "Percentage" | "Absolute";
  smOverridePct: string;
  smOverrideType?: "Percentage" | "Absolute";
  sdOverridePct: string;
  sdOverrideType?: "Percentage" | "Absolute";
  mdCutPct?: string;
  mdCutType?: "Percentage" | "Absolute";
  isExternal: boolean;
  externalCompanyRetainedPct?: string;
  externalCompanyRetainedType?: "Percentage" | "Absolute";
  effectiveDate: string;
};

type DecimalLike = Prisma.Decimal | string;
type CommissionRow = {
  commissionType: "Percentage" | "Fixed";
  closingCommPct: DecimalLike | null;
  closingCommFixed: DecimalLike | null;
  companyCutPct: DecimalLike;
  companyCutType: "Percentage" | "Absolute";
  smOverridePct: DecimalLike;
  smOverrideType: "Percentage" | "Absolute";
  sdOverridePct: DecimalLike;
  sdOverrideType: "Percentage" | "Absolute";
  mdCutPct: DecimalLike;
  mdCutType: "Percentage" | "Absolute";
  isExternal: boolean;
  externalCompanyRetainedPct: DecimalLike | null;
  externalCompanyRetainedType: "Percentage" | "Absolute";
  effectiveDate: Date;
};

const pct = (v: DecimalLike) => D(v).toFixed(4);
const cash = (v: DecimalLike) => D(v).toFixed(2);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** What createProduct/updateProduct WOULD store for this input. Mirrors their
 *  column mapping exactly (the closing value only for its own commission type,
 *  "0" for an empty cut/override, the retained % only for an external product). */
export function canonicalFromInput(i: CommissionInput): CanonicalCommission {
  return {
    commissionType: i.commissionType,
    closingCommPct: i.commissionType === "Percentage" && i.closingCommPct ? pct(i.closingCommPct) : null,
    closingCommFixed: i.commissionType === "Fixed" && i.closingCommFixed ? cash(i.closingCommFixed) : null,
    companyCutPct: pct(i.companyCutPct || "0"),
    companyCutType: i.companyCutType ?? "Percentage",
    smOverridePct: pct(i.smOverridePct || "0"),
    smOverrideType: i.smOverrideType ?? "Percentage",
    sdOverridePct: pct(i.sdOverridePct || "0"),
    sdOverrideType: i.sdOverrideType ?? "Percentage",
    mdCutPct: pct(i.mdCutPct || "0"),
    mdCutType: i.mdCutType ?? "Percentage",
    isExternal: i.isExternal,
    externalCompanyRetainedPct: i.isExternal ? pct(i.externalCompanyRetainedPct || "0") : null,
      externalCompanyRetainedType: i.externalCompanyRetainedType ?? "Percentage",
    effectiveDate: day(new Date(i.effectiveDate)),
  };
}

/** What the product row currently holds, in the same canonical form — i.e. the
 *  value the engine/create would treat it as. Normalised like canonicalFromInput
 *  so that a legacy row's leftovers never read as an edit the person did not make:
 *  the closing value of the OTHER commission type is ignored, and an external
 *  product with no retained % reads as 0 (what create stores for it). */
export function canonicalFromRow(r: CommissionRow): CanonicalCommission {
  return {
    commissionType: r.commissionType,
    closingCommPct: r.commissionType === "Percentage" && r.closingCommPct != null ? pct(r.closingCommPct) : null,
    closingCommFixed: r.commissionType === "Fixed" && r.closingCommFixed != null ? cash(r.closingCommFixed) : null,
    companyCutPct: pct(r.companyCutPct),
    companyCutType: r.companyCutType,
    smOverridePct: pct(r.smOverridePct),
    smOverrideType: r.smOverrideType,
    sdOverridePct: pct(r.sdOverridePct),
    sdOverrideType: r.sdOverrideType,
    mdCutPct: pct(r.mdCutPct),
    mdCutType: r.mdCutType,
    isExternal: r.isExternal,
    externalCompanyRetainedPct: r.isExternal ? pct(r.externalCompanyRetainedPct ?? "0") : null,
      externalCompanyRetainedType: r.externalCompanyRetainedType,
    effectiveDate: day(r.effectiveDate),
  };
}

/** The commission cross-field rule — the closing value its commission type calls
 *  for. ONE function, used by create, the edit action AND the edit
 *  screen (which shows the offending field when stored data would fail it).
 *  Returns an `errors.*` message key, or null when valid. */
export function validateCommission(i: {
  commissionType: "Percentage" | "Fixed";
  closingCommPct?: string | null;
  closingCommFixed?: string | null;
}): "closingPctRequired" | "closingFixedRequired" | null {
  if (i.commissionType === "Percentage" && !i.closingCommPct) return "closingPctRequired";
  if (i.commissionType === "Fixed" && !i.closingCommFixed) return "closingFixedRequired";
  return null;
}

/** The field names whose values differ — empty means the commission structure
 *  was not touched, so no new rate version is written. */
export function changedCommissionFields(before: CanonicalCommission, after: CanonicalCommission): string[] {
  return (Object.keys(after) as (keyof CanonicalCommission)[]).filter((k) => before[k] !== after[k]);
}

/** THE FLOOR on a rate change's effective date, in days from today: 0 = today
 *  is the earliest allowed, 1 = tomorrow. One line to switch. A rate change may
 *  not be backdated: a version effective in the past would reprice pending,
 *  unverified sales dated on or after it (they resolve their version at verify,
 *  by sales date) — money moving under someone's feet. */
export const RATE_CHANGE_FLOOR_DAYS_AHEAD = 0;

/** yyyy-mm-dd of the earliest effective date a rate change may carry, in the
 *  app's own day (the process TZ, Asia/Singapore by default — the same
 *  `format(new Date(), "yyyy-MM-dd")` convention the forms use for "today"). */
export function earliestRateChangeDate(now: Date = new Date()): string {
  return format(addDays(now, RATE_CHANGE_FLOOR_DAYS_AHEAD), "yyyy-MM-dd");
}
