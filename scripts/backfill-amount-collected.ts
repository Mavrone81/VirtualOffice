/**
 * A-0 backfill — DRY RUN ONLY. Reports, for every SalesTransaction, what
 * amountCollected should be (Σ paid invoice amounts + Σ paid installment
 * dueAmounts) versus what is stored, and flags anything that needs a human:
 * an installment plan with a deposit but no sequence-0 row (predates the
 * deposit schedule-row change), or a raw sum that exceeds the sale amount
 * (a duplicate invoice, a schedule bug — M1, Architect money review). See
 * server/transactions/amount-collected-backfill-plan.ts for the exact rules.
 *
 * It CANNOT write: the Prisma client below only lets read operations through
 * (no model writes, no raw SQL), the runbook runs it in a read-only DB
 * session, and there is no apply mode. Applying is a separate, reviewed
 * change that needs the project owner's go because it writes production data — designed
 * the same way as M5's (scripts/backfill-payout-ids.ts): a hash-checked plan
 * (this script's --json prints the plan's own SHA-256, which the future
 * apply will require via --confirm), per-month before/after totals, and a
 * pre-apply pg_dump + restore check.
 *
 * Output contains ids, codes and amounts only — no names or other personal data.
 *   DATABASE_URL="<url>&options=-c%20default_transaction_read_only%3Don" \
 *     pnpm tsx scripts/backfill-amount-collected.ts          # per-month table + one line per transaction that needs a look
 *   (…same…) pnpm tsx scripts/backfill-amount-collected.ts --json   # { planHash, generatedAt, rows } — the future apply's input
 * It aborts unless the session reports transaction_read_only = on.
 */
import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import { planAmountCollectedBackfill, summariseByMonth } from "@/server/transactions/amount-collected-backfill-plan";

// Allowlist, not blocklist — see scripts/backfill-payout-ids.ts for the rationale.
const READ_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
]);

const readOnly = new PrismaClient().$extends({
  query: {
    $allOperations({ operation, args, query }) {
      if (!READ_OPS.has(operation)) throw new Error(`backfill-amount-collected is read-only; refused ${operation}`);
      return query(args);
    },
  },
});

/** Pre-flight (R1): refuse to run unless the DB session itself is read-only. */
async function assertReadOnlySession(): Promise<void> {
  const base = new PrismaClient();
  try {
    const [row] = await base.$queryRaw<{ transaction_read_only: string }[]>`SHOW transaction_read_only`;
    if (row?.transaction_read_only !== "on") {
      throw new Error(
        `DB session is not read-only (transaction_read_only=${row?.transaction_read_only ?? "?"}). ` +
          "Append options=-c%20default_transaction_read_only%3Don to DATABASE_URL (with & if it already has a ?).",
      );
    }
  } finally {
    await base.$disconnect();
  }
}

async function main() {
  if (process.argv.includes("--apply")) throw new Error("No apply mode: this script is a dry run only.");
  await assertReadOnlySession();
  const rows = await planAmountCollectedBackfill(readOnly as unknown as PrismaClient);

  if (process.argv.includes("--json")) {
    // Canonical form for the hash: rows are already ordered by transactionCode
    // (deterministic), no pretty-printing, so re-deriving the hash from a
    // saved plan.json's `rows` always matches — the future apply's --confirm.
    const canonical = JSON.stringify(rows);
    const planHash = createHash("sha256").update(canonical).digest("hex");
    console.log(JSON.stringify({ planHash, generatedAt: new Date().toISOString(), rows }, null, 2));
    return;
  }

  const count = (a: string) => rows.filter((r) => r.action === a).length;
  console.log(`[DRY RUN] transactions checked: ${rows.length}`);
  console.log(`  clean:                          ${count("clean")}`);
  console.log(`  to-update:                      ${count("to-update")}`);
  console.log(`  manual — over-collected:        ${count("manual-over-collected")}`);
  console.log(`  manual — deposit rule pending:  ${count("manual-deposit-rule-pending")}`);

  console.log("");
  console.log("  month    transactions  collected_before  collected_after  to_update  manual");
  for (const m of summariseByMonth(rows)) {
    console.log(
      `  ${m.month}  ${String(m.transactions).padStart(12)}  ${m.collectedBefore.padStart(16)}` +
        `  ${m.collectedAfter.padStart(15)}  ${String(m.toUpdate).padStart(9)}  ${String(m.manual).padStart(6)}`,
    );
  }

  console.log("");
  for (const r of rows) {
    if (r.action === "clean") continue;
    console.log(
      `  ${r.transactionCode} sale=${r.saleAmount} stored=${r.storedAmountCollected} raw=${r.rawCollected} computed=${r.computedAmountCollected} -> ${r.action}`,
    );
  }
  console.log("[DRY RUN] nothing was changed.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => readOnly.$disconnect());
