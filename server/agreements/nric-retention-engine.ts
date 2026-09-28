import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditTx } from "@/lib/audit";
import { env } from "@/lib/env";

// A-17 §4a: for sales rejected 30+ days ago, the NRIC fields on their Pets
// Ashes agreement (draft or signed) are erased. Signed PDFs, their key and
// hash are never touched — they're the legal record. In-app trigger, no
// host cron: an opportunistic call on every admin page load (at most once a
// day) and a manual Business-Admin panel (Preview/Run now).
//
// A real purge is off by default (NRIC_RETENTION_ENABLED) — the first
// activation needs the owner's explicit go, reviewed against a Preview,
// like every other write against production data. Preview itself is never
// gated: it's a pure read and the input to that decision. Whether Legacy
// (pre-A-17) rejected rows are purged at all is a second, separate switch
// (NRIC_RETENTION_INCLUDE_LEGACY) — Q13/Q15 were decided with the new flow
// in mind, so Legacy inclusion is the owner's own later call.
//
// Not a server action: this file has no `"use server"` directive. Only the
// two authz-checked wrappers in ./nric-retention are client-callable
// endpoints; these three are plain functions the wrappers (and the
// opportunistic in-app trigger) import.
const RETENTION_DAYS = 30;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Arbitrary fixed key for pg_try_advisory_xact_lock — this job only ever
// needs one lock, held for exactly the length of one run's transaction.
const RETENTION_LOCK_KEY = 481700301;

type EligibleRow = {
  id: string;
  flow: "Legacy" | "ClosedDeal";
  applicant1_nric: string | null;
  applicant2_nric: string | null;
  applicant_witness_nric: string | null;
  company_witness_nric: string | null;
};

const NRIC_FIELDS = ["applicant1Nric", "applicant2Nric", "applicantWitnessNric", "companyWitnessNric"] as const;
const NRIC_COLUMN: Record<(typeof NRIC_FIELDS)[number], keyof EligibleRow> = {
  applicant1Nric: "applicant1_nric",
  applicant2Nric: "applicant2_nric",
  applicantWitnessNric: "applicant_witness_nric",
  companyWitnessNric: "company_witness_nric",
};
function nonNullFields(row: EligibleRow): (typeof NRIC_FIELDS)[number][] {
  return NRIC_FIELDS.filter((f) => row[NRIC_COLUMN[f]] !== null);
}

async function eligibleRows(db: Prisma.TransactionClient, cutoff: Date, includeLegacy: boolean, lockForWrite: boolean): Promise<EligibleRow[]> {
  const flowFilter = includeLegacy ? Prisma.empty : Prisma.sql`AND s.flow = 'ClosedDeal'`;
  const lockClause = lockForWrite ? Prisma.sql`FOR UPDATE OF a SKIP LOCKED` : Prisma.empty;
  return db.$queryRaw<EligibleRow[]>`
    SELECT a.id, s.flow, a.applicant1_nric, a.applicant2_nric, a.applicant_witness_nric, a.company_witness_nric
    FROM pets_ashes_agreements a
    JOIN sales_submissions s ON s.id = a.submission_id
    WHERE s.status = 'Rejected'
      AND COALESCE(s.rejected_at, s.updated_at) <= ${cutoff}
      AND (a.applicant1_nric IS NOT NULL OR a.applicant2_nric IS NOT NULL
           OR a.applicant_witness_nric IS NOT NULL OR a.company_witness_nric IS NOT NULL)
      ${flowFilter}
    ORDER BY a.id
    ${lockClause}
  `;
}

export type NricRetentionCounts = {
  inScope: number;
  byField: Record<(typeof NRIC_FIELDS)[number], number>;
  processed: number;
  capped: boolean;
  /** Preview only — BOTH flows, regardless of NRIC_RETENTION_INCLUDE_LEGACY,
   *  so the owner can see what each switch would do before deciding. */
  byFlow?: { legacy: number; closedDeal: number };
  byMonth?: { month: string; legacy: number; closedDeal: number }[];
};

/**
 * The real (or dry-run) purge. `trigger`/`actorUserId` are audit-only (actor
 * is null for the opportunistic trigger). `skipCooldown` is for the manual
 * "Run now" panel. Returns `ran: false` — never a partial run — when: a real
 * run is disabled (NRIC_RETENTION_ENABLED=false), the advisory lock is held
 * elsewhere, or (unless skipping) the last run was under 24h ago.
 */
export async function runNricRetention(opts: {
  dryRun: boolean;
  trigger: "opportunistic" | "manual";
  actorUserId: string | null;
  skipCooldown?: boolean;
}): Promise<{ ran: boolean; counts?: NricRetentionCounts }> {
  if (!opts.dryRun && !env.NRIC_RETENTION_ENABLED) return { ran: false };
  const cap = env.NRIC_RETENTION_DAILY_CAP;
  const includeLegacy = env.NRIC_RETENTION_INCLUDE_LEGACY;

  return prisma.$transaction(async (db) => {
    const lock = await db.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_KEY}) AS locked`;
    if (!lock[0]?.locked) return { ran: false };

    if (!opts.skipCooldown) {
      const lastRun = await db.auditLog.findFirst({
        where: { action: "ashes.nric_retention_run" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (lastRun && Date.now() - lastRun.createdAt.getTime() < COOLDOWN_MS) return { ran: false };
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    // Legacy rows without rejectedAt fall back to updatedAt (never earlier
    // than the real rejection, so this can only purge later, never earlier).
    const eligible = await eligibleRows(db, cutoff, includeLegacy, true);

    const byField: NricRetentionCounts["byField"] = { applicant1Nric: 0, applicant2Nric: 0, applicantWitnessNric: 0, companyWitnessNric: 0 };
    for (const row of eligible) for (const f of nonNullFields(row)) byField[f]++;

    const toProcess = opts.dryRun ? [] : eligible.slice(0, cap);
    const capped = !opts.dryRun && eligible.length > cap;

    for (const row of toProcess) {
      await db.petsAshesAgreement.update({
        where: { id: row.id },
        data: { applicant1Nric: null, applicant2Nric: null, applicantWitnessNric: null, companyWitnessNric: null },
      });
      // Field names only, never values (§4a's own rule).
      await auditTx(db, { action: "ashes.nric_purged", entityType: "PetsAshesAgreement", entityId: row.id, actorUserId: opts.actorUserId, after: { fields: nonNullFields(row) } });
    }

    await auditTx(db, {
      action: "ashes.nric_retention_run", entityType: "PetsAshesAgreement", entityId: null, actorUserId: opts.actorUserId,
      after: { trigger: opts.trigger, dryRun: opts.dryRun, includeLegacy, inScope: eligible.length, processed: toProcess.length, capped },
    });

    return { ran: true, counts: { inScope: eligible.length, byField, processed: toProcess.length, capped } };
  });
}

/**
 * Preview: counts only, no lock, no cooldown, never gated by
 * NRIC_RETENTION_ENABLED — a pure read, and the input to the owner's
 * decision to turn the real switches on. Always reports BOTH flows and a
 * per-rejection-month split, regardless of NRIC_RETENTION_INCLUDE_LEGACY,
 * so the owner sees what each switch would actually do.
 */
export async function previewNricRetention(): Promise<NricRetentionCounts> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const rowsWithMonth = await prisma.$queryRaw<(EligibleRow & { month: string })[]>`
    SELECT a.id, s.flow, a.applicant1_nric, a.applicant2_nric, a.applicant_witness_nric, a.company_witness_nric,
           to_char(COALESCE(s.rejected_at, s.updated_at), 'YYYY-MM') AS month
    FROM pets_ashes_agreements a
    JOIN sales_submissions s ON s.id = a.submission_id
    WHERE s.status = 'Rejected'
      AND COALESCE(s.rejected_at, s.updated_at) <= ${cutoff}
      AND (a.applicant1_nric IS NOT NULL OR a.applicant2_nric IS NOT NULL
           OR a.applicant_witness_nric IS NOT NULL OR a.company_witness_nric IS NOT NULL)
    ORDER BY a.id
  `;

  const byField: NricRetentionCounts["byField"] = { applicant1Nric: 0, applicant2Nric: 0, applicantWitnessNric: 0, companyWitnessNric: 0 };
  const byFlow = { legacy: 0, closedDeal: 0 };
  const months = new Map<string, { legacy: number; closedDeal: number }>();
  for (const row of rowsWithMonth) {
    for (const f of nonNullFields(row)) byField[f]++;
    if (row.flow === "Legacy") byFlow.legacy++; else byFlow.closedDeal++;
    const m = months.get(row.month) ?? { legacy: 0, closedDeal: 0 };
    if (row.flow === "Legacy") m.legacy++; else m.closedDeal++;
    months.set(row.month, m);
  }

  return {
    inScope: rowsWithMonth.length, byField, processed: 0, capped: false, byFlow,
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
  };
}

/** The admin layout's opportunistic call, scheduled via Next's `after()`. Never
 *  lets a failure here change the page response — logged, not thrown. A no-op
 *  while NRIC_RETENTION_ENABLED is off. */
export async function runNricRetentionOpportunistic(): Promise<void> {
  if (!env.NRIC_RETENTION_ENABLED) return;
  try {
    await runNricRetention({ dryRun: false, trigger: "opportunistic", actorUserId: null });
  } catch (e) {
    console.error("[nric-retention] opportunistic run failed", e instanceof Error ? e.message : e);
  }
}
