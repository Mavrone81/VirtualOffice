import { PayoutStatus, type Prisma, type PrismaClient } from "@prisma/client";

/**
 * Export-stamp backfill PLAN — read-only.
 *
 * The bank file takes every Approved, positive payout that has no bank-file batch.
 * Payouts Approved before the batch column existed have none, so this records which
 * of them an earlier bank file (pre-batch code) already covered.
 *
 * Pre-batch code left one trace of each export: a `payout.bankfile_generated` audit
 * row per month (entityId = month). For each unstamped Approved payout this decides,
 * from the audit trail, whether that month's LAST legacy file could have listed it:
 *   - stamp  — it existed and was Approved when the last file was generated, or the
 *              approval time is unknown (conservative: a stamped payout is held
 *              back from the next file and shows up for reconciliation).
 *   - leave  — no file was ever generated for the month, or the payout was created or
 *              approved after the last file. The next bank file lists it, as it should.
 * `review` marks stamped payouts whose amount may differ from what the file listed
 * (payouts were re-run for the month after that file).
 *
 * Output: ids, months and amounts only — no names or other personal data.
 */
export type ExportStampReason =
  | "approved-before-last-file"
  | "approval-time-unknown"
  | "no-export-record"
  | "created-after-last-file"
  | "approved-after-last-file";

export type ExportStampRow = {
  payoutId: string;
  payoutMonth: string;
  seq: number;
  total: string;
  action: "stamp" | "leave";
  reason: ExportStampReason;
  review: boolean;
  lastFileAt: string | null;
};

export type ExportStampPlan = {
  rows: ExportStampRow[];
  /** Per month to stamp: the time and actor of the last legacy file (the legacy batch copies them). */
  months: Record<string, { lastFileAt: Date; lastFileBy: string | null }>;
  /** Batches from batch-aware exports (not this backfill's). Non-zero means a new export already ran. */
  existingBatches: number;
};

const FILE_ACTION = "payout.bankfile_generated";
const APPROVE_ONE = "payout.Approved";
const APPROVE_ALL = "payouts.approve_all";
const RUN = "payouts.run";
/** file_key of the batches this backfill creates; they are not new-code exports. */
export const LEGACY_BATCH_KEY = "legacy-export-stamp";

type Db = PrismaClient | Prisma.TransactionClient;

/** `months` limits the plan to those payout months (tests); omitted, every month is in scope. */
export async function planExportStamp(db: Db, opts: { months?: string[] } = {}): Promise<ExportStampPlan> {
  const inScope = opts.months ? { payoutMonth: { in: opts.months } } : {};
  const candidates = await db.monthlyPayout.findMany({
    where: { ...inScope, payoutStatus: PayoutStatus.Approved, bankFileBatchId: null, totalPayable: { gt: 0 } },
    select: { id: true, payoutMonth: true, seq: true, totalPayable: true, createdAt: true },
    orderBy: [{ payoutMonth: "asc" }, { id: "asc" }],
  });
  const existingBatches = await db.bankFileBatch.count({
    where: { ...inScope, OR: [{ fileKey: null }, { fileKey: { not: LEGACY_BATCH_KEY } }] },
  });
  if (candidates.length === 0) return { rows: [], months: {}, existingBatches };

  const monthsIn = [...new Set(candidates.map((c) => c.payoutMonth))];
  const monthAudits = await db.auditLog.findMany({
    where: { entityType: "MonthlyPayout", entityId: { in: monthsIn }, action: { in: [FILE_ACTION, APPROVE_ALL, RUN] } },
    select: { action: true, entityId: true, createdAt: true, actorUserId: true },
    orderBy: { createdAt: "asc" },
  });
  const oneApprovals = await db.auditLog.findMany({
    where: { entityType: "MonthlyPayout", action: APPROVE_ONE, entityId: { in: candidates.map((c) => c.id) } },
    select: { entityId: true, createdAt: true },
  });

  const lastFile = new Map<string, { at: Date; by: string | null }>();
  const approveAll = new Map<string, Date[]>();
  const runs = new Map<string, Date[]>();
  for (const a of monthAudits) {
    const m = a.entityId!;
    if (a.action === FILE_ACTION) lastFile.set(m, { at: a.createdAt, by: a.actorUserId }); // ascending → last wins
    else if (a.action === APPROVE_ALL) approveAll.set(m, [...(approveAll.get(m) ?? []), a.createdAt]);
    else runs.set(m, [...(runs.get(m) ?? []), a.createdAt]);
  }
  const approvedAt = new Map<string, Date>();
  for (const a of oneApprovals) {
    const prev = approvedAt.get(a.entityId!);
    if (!prev || a.createdAt > prev) approvedAt.set(a.entityId!, a.createdAt);
  }

  const rows: ExportStampRow[] = [];
  const months: ExportStampPlan["months"] = {};
  for (const p of candidates) {
    const file = lastFile.get(p.payoutMonth);
    const base = { payoutId: p.id, payoutMonth: p.payoutMonth, seq: p.seq, total: p.totalPayable.toFixed(2), lastFileAt: file?.at.toISOString() ?? null };
    let reason: ExportStampReason;
    if (!file) reason = "no-export-record";
    else if (p.createdAt > file.at) reason = "created-after-last-file";
    else {
      const one = approvedAt.get(p.id);
      if (one) reason = one > file.at ? "approved-after-last-file" : "approved-before-last-file";
      else {
        // approve-all only moves payouts that exist at the time, so earlier ones can't have approved this one.
        const alls = (approveAll.get(p.payoutMonth) ?? []).filter((t) => t >= p.createdAt);
        if (alls.length === 0) reason = "approval-time-unknown";
        else if (alls.every((t) => t > file.at)) reason = "approved-after-last-file";
        else reason = "approved-before-last-file";
      }
    }
    const action = reason === "approved-before-last-file" || reason === "approval-time-unknown" ? "stamp" : "leave";
    const review = action === "stamp" && (runs.get(p.payoutMonth) ?? []).some((t) => t > file!.at);
    if (action === "stamp") months[p.payoutMonth] = { lastFileAt: file!.at, lastFileBy: file!.by };
    rows.push({ ...base, action, reason, review });
  }
  return { rows, months, existingBatches };
}

/**
 * Apply the plan in ONE transaction: one legacy batch per month (dated to that month's
 * last legacy file) and a compare-and-swap stamp — only payouts still Approved and
 * unstamped are touched, so a re-run is a no-op. Each stamp is audited. With
 * `expectedStamps`, refuses unless the plan (re-read under the lock) stamps exactly that many. Refuses if a
 * bank file has already been generated by the batch-aware code: from then on the plan
 * can no longer tell a legacy export from a new one.
 */
export async function applyExportStamp(
  prisma: PrismaClient,
  actorUserId: string | null = null,
  expectedStamps?: number,
  opts: { months?: string[] } = {},
): Promise<{ stamped: number; batches: number }> {
  return prisma.$transaction(async (db) => {
    // Serialise with any bank-file generation for the duration of the apply.
    await db.$executeRaw`LOCK TABLE monthly_payouts IN SHARE ROW EXCLUSIVE MODE`;
    const plan = await planExportStamp(db, opts);
    if (plan.existingBatches > 0) throw new Error(`refused: ${plan.existingBatches} bank-file batch(es) already exist — a new export already ran`);
    const planned = plan.rows.filter((r) => r.action === "stamp").length;
    if (expectedStamps !== undefined && planned !== expectedStamps) throw new Error(`refused: the plan stamps ${planned}, not the confirmed ${expectedStamps}`);
    let stamped = 0, batches = 0;
    for (const [month, info] of Object.entries(plan.months)) {
      const ids = plan.rows.filter((r) => r.action === "stamp" && r.payoutMonth === month).map((r) => r.payoutId);
      const batch = await db.bankFileBatch.create({
        data: { payoutMonth: month, generatedAt: info.lastFileAt, generatedById: info.lastFileBy, fileKey: LEGACY_BATCH_KEY },
      });
      batches++;
      const res = await db.monthlyPayout.updateMany({
        where: { id: { in: ids }, bankFileBatchId: null, payoutStatus: PayoutStatus.Approved },
        data: { bankFileBatchId: batch.id },
      });
      stamped += res.count;
      await db.auditLog.create({
        data: {
          actorUserId, action: "payout.export_stamp_backfilled", entityType: "BankFileBatch", entityId: batch.id,
          afterJson: { month, payoutIds: ids, stamped: res.count },
        },
      });
    }
    return { stamped, batches };
  }, { timeout: 120_000 }); // one pass over every legacy month: allow more than Prisma's 5 s default
}
