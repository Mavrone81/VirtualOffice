// Export-stamp backfill: payouts Approved before bank-file batches existed carry no
// batch; the backfill records which of them a legacy bank file already covered. Needs a local PG (DATABASE_URL); fake data only, tagged and
// cleaned up. Months are far-future and used by no other test.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/server/pii", () => ({ decryptPiiAudited: async () => "(fake)" }));

import { prisma } from "@/lib/db";
import { buildBankFileCsv } from "./bankfile";
import { applyExportStamp, planExportStamp } from "./export-stamp-plan";

const TAG = "EXPSTAMP-";
const A = "2098-01"; // legacy file generated
const B = "2098-02"; // never exported
const C = "2098-03"; // a batch-aware export already ran
const D = "2098-04"; // legacy file generated, no approval record at all
const MONTHS = [A, B, C, D];
const T0 = new Date("2098-02-01T00:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const FILE_AT = day(10);

const ids: Record<string, string> = {};
let associateId = "";

async function payout(key: string, month: string, opts: { created?: Date; status?: "Pending" | "Approved" | "Paid"; total?: number; seq?: number } = {}) {
  const p = await prisma.monthlyPayout.create({
    data: {
      payoutMonth: month, associateId, seq: opts.seq ?? Object.keys(ids).length, associateName: TAG + key, designation: "SalesAssociate" as never,
      totalPayable: opts.total ?? 100, personalCommission: opts.total ?? 100,
      paymentMethod: "PayNow" as never, paynowNumber: "80000000",
      payoutStatus: (opts.status ?? "Approved") as never, createdAt: opts.created ?? T0,
    },
    select: { id: true },
  });
  ids[key] = p.id;
}

async function audit(action: string, entityId: string, at: Date) {
  await prisma.auditLog.create({ data: { action, entityType: "MonthlyPayout", entityId, createdAt: at, actorUserId: null } });
}

async function cleanup() {
  const batches = (await prisma.bankFileBatch.findMany({ where: { payoutMonth: { in: MONTHS } }, select: { id: true } })).map((b) => b.id);
  await prisma.monthlyPayout.deleteMany({ where: { associateName: { startsWith: TAG } } });
  await prisma.bankFileBatch.deleteMany({ where: { id: { in: batches } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...MONTHS, ...batches, ...Object.values(ids)] } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  associateId = (await prisma.associate.create({
    data: { associateCode: TAG + "1", fullName: TAG + "1", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;

  await payout("approvedBefore", A);
  await payout("approveAllBefore", A);
  await payout("unknown", D);
  await payout("approvedAfter", A);
  await payout("createdAfter", A, { created: day(12) });
  await payout("approveAllAfterOnly", A, { created: day(12.5) });
  await payout("paid", A, { status: "Paid" });
  await payout("pending", A, { status: "Pending" });
  await payout("zero", A, { total: 0 });
  await payout("neverExported", B);
  await payout("afterNewExport", C);

  await audit("payout.Approved", ids.approvedBefore, day(1));
  await audit("payouts.approve_all", A, day(2)); // before approveAllAfterOnly existed → can't have approved it
  await audit("payout.Approved", ids.approvedAfter, day(11));
  await audit("payout.bankfile_generated", A, day(3)); // an earlier file: only the LAST one counts
  await audit("payout.bankfile_generated", A, FILE_AT);
  await audit("payouts.approve_all", A, day(13)); // approves approveAllAfterOnly
  await audit("payouts.run", A, day(15)); // a re-run after the file → stamped amounts need review
  await audit("payout.bankfile_generated", C, day(1));
  await audit("payout.bankfile_generated", D, FILE_AT);
  await prisma.bankFileBatch.create({ data: { payoutMonth: C } });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("export-stamp backfill", () => {
  it("before the backfill, legacy-exported payouts are still unstamped candidates", async () => {
    const plan = await planExportStamp(prisma, { months: [A, D] });
    const unstamped = plan.rows.map((r) => r.payoutId);
    expect(unstamped).toEqual(expect.arrayContaining([ids.approvedBefore, ids.approveAllBefore, ids.unknown]));
  });

  it("plans stamp/leave from the audit trail", async () => {
    const plan = await planExportStamp(prisma, { months: [A, B, D] });
    const by = Object.fromEntries(plan.rows.map((r) => [r.payoutId, r]));
    expect(by[ids.approvedBefore]).toMatchObject({ action: "stamp", reason: "approved-before-last-file", review: true });
    expect(by[ids.approveAllBefore]).toMatchObject({ action: "stamp", reason: "approved-before-last-file" });
    expect(by[ids.unknown]).toMatchObject({ action: "stamp", reason: "approval-time-unknown" });
    expect(by[ids.approvedAfter]).toMatchObject({ action: "leave", reason: "approved-after-last-file", review: false });
    expect(by[ids.createdAfter]).toMatchObject({ action: "leave", reason: "created-after-last-file" });
    expect(by[ids.approveAllAfterOnly]).toMatchObject({ action: "leave", reason: "created-after-last-file" });
    expect(by[ids.neverExported]).toMatchObject({ action: "leave", reason: "no-export-record", lastFileAt: null });
    for (const k of ["paid", "pending", "zero"]) expect(by[ids[k]]).toBeUndefined();
    expect(plan.existingBatches).toBe(0);
    expect(plan.months[A].lastFileAt.toISOString()).toBe(FILE_AT.toISOString());
  });

  it("approve-all after the last file leaves a payout that existed before the file unstamped", async () => {
    const p = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: ids.approveAllAfterOnly } });
    await prisma.monthlyPayout.update({ where: { id: p.id }, data: { createdAt: day(5) } });
    try {
      const plan = await planExportStamp(prisma, { months: [A] });
      // the day-2 approve-all predates it (ignored); the only one after its creation is day 13, after the file
      expect(plan.rows.find((r) => r.payoutId === p.id)).toMatchObject({ action: "leave", reason: "approved-after-last-file" });
    } finally {
      await prisma.monthlyPayout.update({ where: { id: p.id }, data: { createdAt: p.createdAt } });
    }
  });

  it("refuses a month where a batch-aware export already ran", async () => {
    await expect(applyExportStamp(prisma, null, undefined, { months: [C] })).rejects.toThrow(/already exist/);
    expect((await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: ids.afterNewExport } })).bankFileBatchId).toBeNull();
  });

  it("refuses when the confirmed count does not match, and writes nothing", async () => {
    await expect(applyExportStamp(prisma, null, 2, { months: [A, B, D] })).rejects.toThrow(/not the confirmed 2/);
    expect(await prisma.bankFileBatch.count({ where: { payoutMonth: { in: [A, B, D] } } })).toBe(0);
  });

  it("apply stamps exactly the planned payouts; the next bank file lists only the rest; a re-run is a no-op", async () => {
    const r = await applyExportStamp(prisma, null, 3, { months: [A, B, D] });
    expect(r).toEqual({ stamped: 3, batches: 2 });
    const batch = await prisma.bankFileBatch.findFirstOrThrow({ where: { payoutMonth: A } });
    expect(batch.generatedAt.toISOString()).toBe(FILE_AT.toISOString());
    const stamped = await prisma.monthlyPayout.findMany({ where: { bankFileBatchId: batch.id }, select: { id: true } });
    expect(stamped.map((s) => s.id).sort()).toEqual([ids.approvedBefore, ids.approveAllBefore].sort());
    const batchD = await prisma.bankFileBatch.findFirstOrThrow({ where: { payoutMonth: D } });
    expect((await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: ids.unknown } })).bankFileBatchId).toBe(batchD.id);
    const trail = await prisma.auditLog.findFirstOrThrow({ where: { action: "payout.export_stamp_backfilled", entityId: batch.id } });
    expect(trail.afterJson).toMatchObject({ month: A, stamped: 2 });

    expect(await applyExportStamp(prisma, null, 0, { months: [A, B, D] })).toEqual({ stamped: 0, batches: 0 });

    const file = await buildBankFileCsv(A, null);
    expect(file.payoutIds.sort()).toEqual([ids.approvedAfter, ids.createdAfter, ids.approveAllAfterOnly].sort());
    expect(file.payoutIds).not.toContain(ids.neverExported); // other month
  });
});
