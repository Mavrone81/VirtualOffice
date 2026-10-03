/**
 * One-off backfill for the Commencement Date requirement (register row C2a).
 * New invites now require a Commencement Date (lib/schemas.ts inviteCandidateSchema,
 * server/recruitment/actions.ts); candidates created before that have none. Rule,
 * decided by the owner: a blank commencement date becomes that record's OWN
 * createdAt — its Singapore calendar date, the date the app shows as "Invited on"
 * (created_at is stored in UTC; the app runs in Asia/Singapore).
 *
 * Touches only candidates.commencement_date, only where it is NULL. No schema
 * change, no migration; updated_at is deliberately left alone so the revert
 * leaves the row exactly as it was.
 *
 * 🔴 REVERSIBLE. --apply first writes a manifest (the affected ids, their prior
 * NULL state and the value written) to disk, BEFORE it changes anything;
 * --revert reads that manifest and puts those rows back to NULL.
 *
 * DRY RUN (default) — needs a read-only DB session, writes nothing:
 *   DATABASE_URL="<url>&options=-c%20default_transaction_read_only%3Don" \
 *     pnpm tsx scripts/backfill-candidate-commencement.ts
 *
 * APPLY — only on the owner's go, with the row count the reviewed dry run printed:
 *   DATABASE_URL="<url>" pnpm tsx scripts/backfill-candidate-commencement.ts \
 *     --apply --confirm=<N> --manifest=<path, must not exist yet>
 * One transaction; refuses if the number of NULL rows is not exactly N. A re-run
 * finds no NULL rows and changes nothing. KEEP THE MANIFEST: it is the undo.
 *
 * REVERT — undo an apply, from its manifest:
 *   DATABASE_URL="<url>" pnpm tsx scripts/backfill-candidate-commencement.ts \
 *     --revert --manifest=<the file --apply wrote>
 * Sets commencement_date back to NULL for the manifest's ids, but only where the
 * value is still the one this script wrote — a row someone has edited since is
 * left alone and reported. Re-running a revert changes nothing.
 *
 * The same undo by hand, for an operator without tsx (ids from the manifest):
 *   UPDATE candidates SET commencement_date = NULL
 *    WHERE id IN ('<id>', '<id>') AND commencement_date = created-date-in-manifest;
 *
 * Output and manifest contain ids and dates only — no names or other personal data.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

type Row = { id: string; createdAt: string; commencementDate: string };
type Manifest = {
  generatedAt: string;
  rule: "commencement_date = created_at (Asia/Singapore calendar date)";
  rows: { id: string; priorCommencementDate: null; writtenCommencementDate: string }[];
};

async function sessionReadOnly(db: PrismaClient): Promise<boolean> {
  const [row] = await db.$queryRaw<{ transaction_read_only: string }[]>`SHOW transaction_read_only`;
  return row?.transaction_read_only === "on";
}

// The candidates still lacking a Commencement Date, with the value each would get.
async function plan(db: Pick<PrismaClient, "$queryRaw">): Promise<Row[]> {
  return db.$queryRaw<Row[]>`
    SELECT id::text AS id,
           to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
           ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore')::date::text AS "commencementDate"
      FROM candidates
     WHERE commencement_date IS NULL
     ORDER BY created_at, id`;
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parseConfirm(): number {
  const raw = arg("--confirm") ?? "";
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n)) throw new Error("--apply needs --confirm=<N>, the row count from the reviewed dry run.");
  return n;
}

function manifestPath(): string {
  const p = arg("--manifest");
  if (!p) throw new Error("--manifest=<path> is required.");
  return p;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const revert = process.argv.includes("--revert");
  if (apply && revert) throw new Error("Pass --apply or --revert, not both.");
  const db = new PrismaClient();
  try {
    const ro = await sessionReadOnly(db);

    if (!apply && !revert) {
      if (!ro) throw new Error("Dry run needs a read-only session: append options=-c%20default_transaction_read_only%3Don to DATABASE_URL.");
      const rows = await plan(db);
      console.log(`candidates with no commencement_date: ${rows.length}`);
      for (const r of rows) console.log([r.id, `created_at=${r.createdAt}`, `would set ${r.commencementDate}`].join("\t"));
      console.log(`\nTo apply (owner's go only): --apply --confirm=${rows.length} --manifest=<new file>`);
      return;
    }

    if (ro) throw new Error("--apply / --revert need a writable session (drop default_transaction_read_only from DATABASE_URL).");

    if (apply) {
      const expected = parseConfirm();
      const path = manifestPath();
      if (existsSync(path)) throw new Error(`refused: ${path} already exists; a manifest is never overwritten.`);
      const result = await db.$transaction(async (tx) => {
        // Lock the NULL rows so the set cannot change between the manifest and the write.
        await tx.$queryRaw`SELECT id FROM candidates WHERE commencement_date IS NULL FOR UPDATE`;
        const rows = await plan(tx);
        if (rows.length !== expected) throw new Error(`refused: ${rows.length} candidates lack a commencement_date, not ${expected}. Re-run the dry run and review it.`);
        const manifest: Manifest = {
          generatedAt: new Date().toISOString(),
          rule: "commencement_date = created_at (Asia/Singapore calendar date)",
          rows: rows.map((r) => ({ id: r.id, priorCommencementDate: null, writtenCommencementDate: r.commencementDate })),
        };
        // Prior state is on disk BEFORE the update. "wx" fails if the file exists. A manifest
        // left by a run that then rolled back is harmless: revert skips rows still NULL.
        writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
        const updated = await tx.$executeRaw`
          UPDATE candidates
             SET commencement_date = ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore')::date
           WHERE commencement_date IS NULL`;
        if (updated !== expected) throw new Error(`rolled back: updated ${updated} rows, expected ${expected}.`);
        return { updated, ids: rows.map((r) => r.id) };
      });
      console.log(`backfilled ${result.updated} candidate(s) to their creation date: ${result.ids.join(", ")}`);
      console.log(`manifest (the undo): ${path}`);
      return;
    }

    // --revert
    const path = manifestPath();
    const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
    if (!Array.isArray(manifest.rows) || manifest.rows.length === 0) throw new Error(`${path} has no rows.`);
    let restored = 0;
    const left: string[] = [];
    await db.$transaction(async (tx) => {
      for (const r of manifest.rows) {
        const n = await tx.$executeRaw`
          UPDATE candidates SET commencement_date = NULL
           WHERE id = ${r.id}::uuid AND commencement_date = ${r.writtenCommencementDate}::date`;
        if (n === 1) restored++;
        else left.push(r.id);
      }
    });
    console.log(`restored to NULL: ${restored} of ${manifest.rows.length}`);
    if (left.length > 0) console.log(`left as they are (already NULL, edited since, or gone): ${left.join(", ")}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
