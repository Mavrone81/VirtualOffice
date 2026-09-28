/**
 * A-17 §1c/§9 (S4) — READ-ONLY runbook step. Reports every SalesSubmission
 * by status (and by flow, once that column exists), and lists the ones still
 * open (Submitted / QuotationApproved) — these are the rows Q3 needs the project owner's
 * per-row call on: close them under the old flow before deploy, or reject and
 * re-submit under the new flow. Run this twice: once before the phase-1
 * deploy (the migration hasn't added `flow` yet, so that column is reported
 * as "n/a"), and again right before phase 2 (flipping A17_CLOSED_DEAL_FLOW)
 * — the design note calls for a fresh count taken right before each step,
 * not a cached one.
 *
 * It CANNOT write: same read-only Prisma extension + DB-session read-only
 * check as scripts/backfill-amount-collected.ts. There is no apply mode —
 * this script only ever counts and lists, it never changes a row.
 *
 * Output contains ids, codes, dates and amounts only — no client names or
 * other personal data.
 *   DATABASE_URL="<url>&options=-c%20default_transaction_read_only%3Don" \
 *     pnpm tsx scripts/a17-legacy-status-count.ts
 */
import { PrismaClient, SubmissionStatus } from "@prisma/client";

const READ_OPS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

const readOnly = new PrismaClient().$extends({
  query: {
    $allOperations({ operation, args, query }) {
      if (!READ_OPS.has(operation)) throw new Error(`a17-legacy-status-count is read-only; refused ${operation}`);
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

const OPEN_STATUSES: SubmissionStatus[] = [SubmissionStatus.Submitted, SubmissionStatus.QuotationApproved];

async function main() {
  await assertReadOnlySession();

  const byStatus = await readOnly.salesSubmission.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("[READ ONLY] sales_submissions by status:");
  for (const row of byStatus) console.log(`  ${row.status.padEnd(20)} ${row._count._all}`);

  let byFlow: { flow: string; _count: { _all: number } }[] | null = null;
  try {
    byFlow = await readOnly.salesSubmission.groupBy({ by: ["flow"], _count: { _all: true } });
  } catch {
    console.log("\n(flow column not present yet — this is a pre-phase-1 run)");
  }
  if (byFlow) {
    console.log("\nby flow:");
    for (const row of byFlow) console.log(`  ${row.flow.padEnd(12)} ${row._count._all}`);
  }

  const open = await readOnly.salesSubmission.findMany({
    where: { status: { in: OPEN_STATUSES } },
    select: { id: true, status: true, salesDate: true, saleAmount: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n[OPEN — Q3: the project owner's per-row call before deploy] ${open.length} row(s):`);
  for (const s of open) {
    console.log(`  ${s.id}  ${s.status.padEnd(18)} sale=${s.salesDate.toISOString().slice(0, 10)} amount=${s.saleAmount.toFixed(2)} created=${s.createdAt.toISOString().slice(0, 10)}`);
  }
  if (open.length === 0) console.log("  none — nothing open, safe to proceed.");
  console.log("\n[READ ONLY] nothing was changed.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => readOnly.$disconnect());
