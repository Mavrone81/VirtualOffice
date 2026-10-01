import { AshesAgreementStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditTx } from "@/lib/audit";

// N2 residual (reviews/a17-flag-on-preconditions.md §2.4, #81's own commit
// message vs what it actually closed): signAshesAgreement's CAS that flips
// status to Signed commits on its own, BEFORE renderAshesAgreementPdf,
// putObject and the pdfKey/docket/audit transaction that follows it. #81
// made THAT later group atomic, but process death between the CAS and the
// render — or between the render and putObject, or between putObject and
// the transaction starting — still leaves a row at `status: Signed,
// agreementPdfKey: null`. Fault injection (the #81 test) proves the
// EXCEPTION path inside the try/catch around the render call; it cannot
// exercise a process crash, which is the actual gap. No reconciler, sweep
// or startup repair exists for this state today — the only code that
// matches it is the two in-process revert sites inside signAshesAgreement
// itself, and neither runs if the process is what died.
//
// ALERT ONLY, deliberately (owner's call still open — detection first,
// remediation second): a row in this state carries a REAL signature the
// client already gave (applicantSignatureKey is set). Auto-reverting it to
// Draft would discard that signature without asking, which is worse than
// leaving it visible and unresolved. This file never writes to a
// PetsAshesAgreement row, never deletes anything, and never touches
// signedPdfSha256 — the only write anywhere here is an AuditLog entry
// recording that a check ran and what it found.
//
// Same in-app scheduling shape as §4a's NRIC retention job (one opportunistic
// trigger via admin-layout `after()`, a cooldown so it doesn't re-audit on
// every page load, a manual immediate check) — following that precedent
// rather than a host cron or a second mechanism. Unlike NRIC retention,
// this needs no owner-go flag: its only write is a rate-limited append to
// an append-only audit table, which cannot damage business data.

// How long a row may legitimately sit at Signed with no agreementPdfKey
// before it's flagged, rather than being mid-flight through a healthy
// request. Justified from measurement, not a guess: tonight's box, under
// real contention (load average 20+, several lanes rendering PDFs at
// once), pushed PDF-adjacent operations that normally take ~1-3s up to
// ~20s — about a 10x slowdown. Doubling that worst-case-observed margin
// for GC pauses, disk contention and retries still lands under 2 minutes
// for the render+upload+transaction sequence this window spans. 10 minutes
// is 5x that doubled margin: generous enough that no healthy request should
// ever cross it, while still catching a real incident inside the hour via
// the opportunistic trigger's own cooldown below.
const STUCK_AGE_MS = 10 * 60 * 1000;
// Separate from NRIC retention's 24h: this state is money-adjacent and
// should surface sooner than a privacy-purge cadence, but an admin-heavy
// hour of page loads still shouldn't write one audit entry per load.
const CHECK_COOLDOWN_MS = 60 * 60 * 1000;
// Arbitrary, fixed, and distinct from NRIC retention's own lock key
// (481700301) — this job's advisory lock only ever needs to be held for the
// length of this read + its one audit write.
const STUCK_CHECK_LOCK_KEY = 481700477;

export type StuckSignedAgreement = {
  id: string;
  submissionId: string;
  signedAt: Date;
  ageMs: number;
};

/** Read-only: every PetsAshesAgreement stuck at Signed with no
 *  agreementPdfKey, signed at least STUCK_AGE_MS ago. No cap — unlike a
 *  purge, listing an extra row costs nothing and hiding one defeats the
 *  point of an alert. Takes a client so runStuckSignedCheck can pass its
 *  own transaction client — called with no argument (the default, module-
 *  level `prisma`), this would run on a SECOND pool connection while that
 *  transaction is still open: a stall shape, and a read outside the
 *  transaction's own snapshot despite looking like it's inside one. */
export async function detectStuckSignedAgreements(db: Prisma.TransactionClient = prisma): Promise<StuckSignedAgreement[]> {
  const cutoff = new Date(Date.now() - STUCK_AGE_MS);
  const rows = await db.petsAshesAgreement.findMany({
    where: { status: AshesAgreementStatus.Signed, agreementPdfKey: null, signedAt: { not: null, lte: cutoff } },
    select: { id: true, submissionId: true, signedAt: true },
    orderBy: { signedAt: "asc" },
  });
  const now = Date.now();
  // signedAt is non-null by construction (filtered above); the Prisma type
  // just can't express that from the where-clause alone.
  return rows.map((r) => ({ id: r.id, submissionId: r.submissionId, signedAt: r.signedAt!, ageMs: now - r.signedAt!.getTime() }));
}

/**
 * Detect-and-audit: runs the same detection, writes exactly one
 * `ashes.stuck_signed_detected` audit entry per run recording the count and
 * ids (never PII — these are internal ids, same as every other audit
 * entry's `after` payload in this codebase), and is rate-limited by the
 * advisory lock + cooldown so repeated opportunistic triggers don't spam
 * the audit log. `skipCooldown` is for the manual "Check now" path.
 * Returns `ran: false` only when the lock is held elsewhere or (unless
 * skipping) the last run was under an hour ago — never a partial result.
 */
export async function runStuckSignedCheck(opts: {
  trigger: "opportunistic" | "manual";
  actorUserId: string | null;
  skipCooldown?: boolean;
}): Promise<{ ran: boolean; stuck?: StuckSignedAgreement[] }> {
  return prisma.$transaction(async (db) => {
    const lock = await db.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${STUCK_CHECK_LOCK_KEY}) AS locked`;
    if (!lock[0]?.locked) return { ran: false };

    // The cooldown's clock IS the audit trail: the last `ashes.stuck_signed_
    // detected` row is both "when did we last check" and "what did we find
    // last time" — there's no separate rate-limit store. Two consequences:
    // (1) a row is written once an hour forever, including every run that
    // finds nothing — ~8,760 permanent "nothing was wrong" rows a year in
    // an append-only table (TRUNCATE is refused: 42501), and the empty ones
    // can't be suppressed without losing the clock they also serve as; (2)
    // if audit_log is ever archived or partitioned, the cooldown silently
    // resets to running on every admin page load — a behaviour change no
    // test here would catch. A separate cooldown store is the clean fix;
    // not needed yet, so documented rather than built.
    if (!opts.skipCooldown) {
      const lastRun = await db.auditLog.findFirst({
        where: { action: "ashes.stuck_signed_detected" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (lastRun && Date.now() - lastRun.createdAt.getTime() < CHECK_COOLDOWN_MS) return { ran: false };
    }

    const stuck = await detectStuckSignedAgreements(db);
    await auditTx(db, {
      action: "ashes.stuck_signed_detected", entityType: "PetsAshesAgreement", entityId: null, actorUserId: opts.actorUserId,
      after: { trigger: opts.trigger, count: stuck.length, ids: stuck.map((s) => s.id) },
    });
    return { ran: true, stuck };
  });
}

/** The admin layout's opportunistic call, scheduled via Next's `after()` —
 *  same pattern as runNricRetentionOpportunistic. Never lets a failure here
 *  change the page response. No enable flag: unlike NRIC retention, there
 *  is no write to a signed row this could ever make, so there is nothing
 *  here that needs the owner's go to turn on. */
export async function runStuckSignedCheckOpportunistic(): Promise<void> {
  try {
    await runStuckSignedCheck({ trigger: "opportunistic", actorUserId: null });
  } catch (e) {
    console.error("[stuck-signed] opportunistic check failed", e instanceof Error ? e.message : e);
  }
}
