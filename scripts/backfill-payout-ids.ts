/**
 * M5 backfill — DRY RUN ONLY. Reports, for every Approved/Paid payout that has no
 * ledger lines attached (payouts made before commission_ledger.payout_id existed),
 * which lines it would be linked to, and flags anything that needs a human.
 *
 * It CANNOT write: the Prisma client below only lets read operations through (no
 * model writes, no raw SQL), the runbook runs it in a read-only DB session, and there
 * is no apply mode. Linking is a separate, reviewed change that needs Samuel's go
 * because it touches production data.
 *
 * Output contains ids and amounts only — no names or other personal data.
 *   pnpm tsx scripts/backfill-payout-ids.ts            # summary + one line per payout
 *   pnpm tsx scripts/backfill-payout-ids.ts --json     # machine-readable
 */
import { PrismaClient } from "@prisma/client";
import { planPayoutBackfill } from "@/server/payouts/backfill-plan";

// Allowlist, not blocklist: only these read operations reach the database. Every
// other operation — model writes and ALL raw SQL ($queryRaw can run UPDATE … RETURNING)
// — is refused. Run it in a DB-enforced read-only session as well (see the runbook:
// DATABASE_URL …&options=-c%20default_transaction_read_only%3Don).
const READ_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
]);

const readOnly = new PrismaClient().$extends({
  query: {
    $allOperations({ operation, args, query }) {
      if (!READ_OPS.has(operation)) throw new Error(`backfill-payout-ids is read-only; refused ${operation}`);
      return query(args);
    },
  },
});

async function main() {
  if (process.argv.includes("--apply")) throw new Error("No apply mode: this script is a dry run only.");
  const rows = await planPayoutBackfill(readOnly as unknown as PrismaClient);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const count = (a: string) => rows.filter((r) => r.action === a).length;
  console.log(`[DRY RUN] legacy Approved/Paid payouts without linked lines: ${rows.length}`);
  console.log(`  attach (lines sum exactly to payout total): ${count("attach")}`);
  console.log(`  manual — lines do not sum to payout total: ${count("manual-mismatch")}`);
  console.log(`  manual — no candidate lines found:         ${count("manual-no-lines")}`);
  console.log(`  manual — Paid but rewritten after paid date (M5 overwrite): ${count("manual-overwritten")}`);
  console.log(`  manual — total zero or negative:           ${count("manual-non-positive")}`);

  // Per month: what the apply step would link, and the totals it must leave unchanged.
  // Linking never changes an amount, so "after" = "before" for every payout total;
  // the apply step re-prints this table from the DB after committing and must match.
  console.log("");
  console.log("  month    payouts  payout_total  attach  lines_to_link  lines_total  manual");
  const months = [...new Set(rows.map((r) => r.payoutMonth))].sort();
  for (const m of months) {
    const mr = rows.filter((r) => r.payoutMonth === m);
    const sum = (xs: string[]) => xs.reduce((a, x) => a + Math.round(Number(x) * 100), 0) / 100;
    const att = mr.filter((r) => r.action === "attach");
    console.log(
      `  ${m}  ${String(mr.length).padStart(7)}  ${sum(mr.map((r) => r.payoutTotal)).toFixed(2).padStart(12)}` +
        `  ${String(att.length).padStart(6)}  ${String(att.reduce((a, r) => a + r.lineIds.length, 0)).padStart(13)}` +
        `  ${sum(att.map((r) => r.linesTotal)).toFixed(2).padStart(11)}  ${String(mr.length - att.length).padStart(6)}`,
    );
  }
  console.log("");
  for (const r of rows) {
    console.log(
      `  ${r.payoutMonth} ${r.payoutId} ${r.status} payout=${r.payoutTotal} lines=${r.linesTotal} n=${r.lineIds.length} -> ${r.action}` +
        (r.possiblyOverwritten ? " [possibly overwritten]" : ""),
    );
  }
  console.log("[DRY RUN] nothing was changed.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => readOnly.$disconnect());
