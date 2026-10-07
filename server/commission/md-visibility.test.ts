import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The managing-director cut is admin-only (owner, 2026-10-07). That rule lives
 * across ~20 files that read the commission ledger, which is precisely the
 * shape of rule that gets applied in nineteen places and quietly missed in the
 * twentieth.
 *
 * So this does not test behaviour — it tests that the guard is IN FORCE. It
 * scans server/ for ledger reads and takes its denominator from the directory,
 * not from a list I wrote: a file added next month is covered without anybody
 * remembering this test exists. Every hit must either carry EXCLUDE_MD_CUT,
 * constrain lineType itself (which already excludes the cut), or appear in the
 * allowlist below WITH a stated reason.
 */

const ROOT = join(__dirname, "..");

/** Reads that may legitimately see the managing-director cut. */
const ALLOWED: Record<string, string> = {
  "commission/run.ts": "the engine WRITES these lines; it is not a viewing surface",
  "commission/md-visibility.ts": "defines the filter",
  "commission/settle.ts": "settlement reconciles what was booked, including this line",
  "payouts/actions.ts": "the admin payout page — one of the three screens the owner named",
  "payouts/totals.ts": "admin payout totals must include it, or the payout would not balance",
  "payouts/catchup.ts": "admin payout path",
  "payouts/backfill-plan.ts": "admin payout path",
  "payouts/reconcile-candidates.ts": "admin payout path",
  "invoices/settled-check.ts": "asks whether a transaction is fully settled; excluding a real booked line would misreport that",
  "vouchers/get-or-create.ts": "payment voucher for an admin payout run",
  "associates/actions.ts": "the 'never used' delete guard must count EVERY line, or a managing director with only cut lines would look deletable",
  "sales/team-commission-column.ts": "already constrained to lineType Personal",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") && !name.includes(".test.")) out.push(full);
  }
  return out;
}

describe("the managing-director cut is filtered out of every non-admin ledger read", () => {
  const files = walk(ROOT);

  // Control first: if this ever reports 0, the scan found nothing and every
  // assertion below would pass vacuously.
  it("the scan actually finds ledger reads (control)", () => {
    const hits = files.filter((f) => readFileSync(f, "utf8").includes("prisma.commissionLedger."));
    expect(hits.length).toBeGreaterThan(5);
  });

  it("every ledger read either filters the cut out or is an allowed admin surface", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.includes("prisma.commissionLedger.")) continue;
      const rel = f.slice(ROOT.length + 1);
      if (rel in ALLOWED) continue;
      if (src.includes("EXCLUDE_MD_CUT")) continue;
      if (src.includes("lineType:")) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      "add EXCLUDE_MD_CUT (server/commission/md-visibility.ts), constrain lineType, or allowlist it here with a reason",
    ).toEqual([]);
  });

  // The allowlist is the part that rots: a file renamed or deleted leaves an
  // entry that silently exempts nothing, and the next real offender gets added
  // to a list nobody trusts any more.
  it("no allowlist entry names a file that no longer exists", () => {
    const stale = Object.keys(ALLOWED).filter((rel) => !files.some((f) => f.slice(ROOT.length + 1) === rel));
    expect(stale, "remove these from ALLOWED").toEqual([]);
  });
});
