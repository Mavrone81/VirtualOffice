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
  console.log(`  Paid and written after paid date (possible M5 overwrite): ${rows.filter((r) => r.possiblyOverwritten).length}`);
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
