// A-17 §4a: runNricRetention — 30-day purge of a rejected sale's Pet Ash
// NRIC fields (draft and signed alike), never the signed PDF/key/hash. In-app
// trigger (advisory lock + 24h cooldown), capped, audited, no PII in the
// audit payload. Real throwaway Postgres.
//
// NRIC_RETENTION_ENABLED gates every real write (DevLead: the first
// activation on production needs the owner's explicit go). ES module imports
// are hoisted ahead of any top-level statement, so setting the env var
// textually "before" a static import does NOT run before that import's own
// module graph reads it — it must be set, then the module dynamically
// imported, in that order (beforeAll below), same as every other flag test
// in this codebase. The gate-off behaviour gets its own dedicated tests via
// a second dynamic import with the var removed.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));

const who: { session: unknown } = { session: null };

import { prisma } from "@/lib/db";
import type * as NricRetentionModule from "./nric-retention";

let runNricRetention: typeof NricRetentionModule.runNricRetention;
let nricRetentionPreview: typeof NricRetentionModule.nricRetentionPreview;
let nricRetentionRunNow: typeof NricRetentionModule.nricRetentionRunNow;
let previewNricRetention: typeof NricRetentionModule.previewNricRetention;

const TAG = "A17NRIC-";
let closerId = "";
const agreementIds: string[] = [];
const submissionIds: string[] = [];

async function mkRejectedAgreement(
  daysAgoRejected: number | null,
  nricFields: Partial<Record<"applicant1Nric" | "applicant2Nric" | "applicantWitnessNric" | "companyWitnessNric", string>>,
  status: "Draft" | "Signed" = "Draft",
  flow: "Legacy" | "ClosedDeal" = "ClosedDeal",
) {
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2026-01-01"), clientName: TAG + "Client", saleAmount: 1000,
      paymentPlan: "FullPayment" as never, amountCollected: 0, closingAssociateId: closerId,
      status: "Rejected" as never, flow: flow as never,
      rejectedAt: daysAgoRejected !== null ? new Date(Date.now() - daysAgoRejected * 24 * 60 * 60 * 1000) : null,
    },
    select: { id: true },
  });
  submissionIds.push(sub.id);
  if (daysAgoRejected === null) {
    // Legacy row: no rejectedAt at all — back-date updated_at directly (Prisma's
    // @updatedAt always stamps "now" through the ORM, so this needs raw SQL).
    await prisma.$executeRawUnsafe(
      `UPDATE sales_submissions SET updated_at = $1 WHERE id = $2::uuid`,
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), sub.id,
    );
  }
  const agreement = await prisma.petsAshesAgreement.create({
    data: {
      submissionId: sub.id, applicant1Name: TAG + "Applicant", amountNumeric: 1000, amountWords: "One Thousand",
      paymentPlan: "FullPayment" as never, status: status as never,
      signedAt: status === "Signed" ? new Date() : null,
      agreementPdfKey: status === "Signed" ? `fake/${sub.id}.pdf` : null,
      signedPdfSha256: status === "Signed" ? "b".repeat(64) : null,
      ...nricFields,
    },
    select: { id: true },
  });
  agreementIds.push(agreement.id);
  return { subId: sub.id, agreementId: agreement.id };
}

beforeAll(async () => {
  process.env.NRIC_RETENTION_ENABLED = "true";
  vi.resetModules();
  ({ runNricRetention, nricRetentionPreview, nricRetentionRunNow, previewNricRetention } = await import("./nric-retention"));

  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  delete process.env.NRIC_RETENTION_ENABLED;
  await prisma.petsAshesAgreement.deleteMany({ where: { id: { in: agreementIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: submissionIds } } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
});

afterEach(() => {
  who.session = null;
});

describe("runNricRetention — scope (30 days)", () => {
  it("purges a row rejected 31 days ago, not one rejected 29 days ago", async () => {
    const { agreementId: old } = await mkRejectedAgreement(31, { applicant1Nric: "S1234567A" });
    const { agreementId: recent } = await mkRejectedAgreement(29, { applicant1Nric: "S7654321B" });

    const r = await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(r.ran).toBe(true);

    expect((await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: old } })).applicant1Nric).toBeNull();
    expect((await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: recent } })).applicant1Nric).toBe("S7654321B");
  });

  it("a legacy row with no rejectedAt falls back to updated_at", async () => {
    const { agreementId } = await mkRejectedAgreement(null, { applicant1Nric: "S1111111C" });
    const r = await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(r.ran).toBe(true);
    expect((await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: agreementId } })).applicant1Nric).toBeNull();
  });

  it("a Signed row's NRIC fields are nulled while its PDF key and hash are untouched", async () => {
    const { agreementId } = await mkRejectedAgreement(31, { applicant1Nric: "S2222222D", companyWitnessNric: "S3333333E" }, "Signed");
    await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    const after = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(after.applicant1Nric).toBeNull();
    expect(after.companyWitnessNric).toBeNull();
    expect(after.status).toBe("Signed");
    expect(after.agreementPdfKey).not.toBeNull();
    expect(after.signedPdfSha256).toBe("b".repeat(64));
  });
});

describe("runNricRetention — dry run", () => {
  it("writes nothing and returns counts only", async () => {
    const { agreementId } = await mkRejectedAgreement(31, { applicant1Nric: "S4444444F" });
    const r = await runNricRetention({ dryRun: true, trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(r.ran).toBe(true);
    expect(r.counts!.processed).toBe(0);
    expect(r.counts!.inScope).toBeGreaterThanOrEqual(1);
    expect((await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: agreementId } })).applicant1Nric).toBe("S4444444F");
  });
});

describe("runNricRetention — locking and cooldown", () => {
  it("while the advisory lock is held elsewhere, a trigger reports ran:false; it succeeds once released", async () => {
    // A deterministic hold, not a Promise.all race — two fast, uncontended
    // transactions can land sequentially on the same pooled connection and
    // never actually overlap, which would prove nothing. This holds the
    // SAME lock open in its own transaction until explicitly released.
    await mkRejectedAgreement(31, { applicant1Nric: "S5555555G" });
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const holder = prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(481700301)`;
      await held;
    });
    await new Promise((r) => setTimeout(r, 20)); // let the holder actually acquire it first

    const blocked = await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(blocked.ran).toBe(false);

    release();
    await holder;
    const allowed = await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(allowed.ran).toBe(true);
  });

  it("a run within the last 24h blocks a cooldown-respecting call; skipCooldown still runs", async () => {
    await mkRejectedAgreement(31, { applicant1Nric: "S6666666H" });
    // Establish a definitely-recent run (audit_log is append-only, so this is
    // the only reliable way to construct "a run just happened" — a prior test
    // file's history can't be relied on to be absent).
    await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });

    const respectsCooldown = await runNricRetention({ dryRun: false, trigger: "opportunistic", actorUserId: null });
    expect(respectsCooldown.ran).toBe(false);

    const manual = await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(manual.ran).toBe(true);
  });
});

describe("runNricRetention — cap", () => {
  it("honours the cap; the remainder is purged by the next run", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { agreementId } = await mkRejectedAgreement(31, { applicant1Nric: `S000000${i}X` });
      ids.push(agreementId);
    }

    process.env.NRIC_RETENTION_DAILY_CAP = "2";
    vi.resetModules();
    const { runNricRetention: cappedRun } = await import("./nric-retention");
    const r1 = await cappedRun({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    delete process.env.NRIC_RETENTION_DAILY_CAP;
    expect(r1.counts!.processed).toBe(2);
    expect(r1.counts!.capped).toBe(true);
    const remainingAfterCap = (await Promise.all(ids.map((id) => prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id } })))).filter((a) => a.applicant1Nric !== null);
    expect(remainingAfterCap).toHaveLength(1);

    // The next run (no cooldown block since skipCooldown, default cap) purges the remainder.
    vi.resetModules();
    const { runNricRetention: uncappedRun } = await import("./nric-retention");
    await uncappedRun({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    for (const id of ids) {
      expect((await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id } })).applicant1Nric).toBeNull();
    }
  });
});

describe("runNricRetention — audit", () => {
  it("the audit payload carries field names only, never NRIC values", async () => {
    const { agreementId } = await mkRejectedAgreement(31, { applicant1Nric: "S9998887Z" });
    await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    const purged = await prisma.auditLog.findFirstOrThrow({ where: { entityId: agreementId, action: "ashes.nric_purged" } });
    expect(purged.afterJson).toEqual({ fields: ["applicant1Nric"] });
    expect(JSON.stringify(purged.afterJson)).not.toContain("S9998887Z");
  });
});

describe("nricRetentionRunNow / Preview — Business Admin only", () => {
  it("refuses Accounts and an anonymous caller; allows Admin", async () => {
    who.session = null;
    expect(await nricRetentionRunNow()).toEqual({ ok: false, error: "forbidden" });
    expect(await nricRetentionPreview()).toEqual({ ok: false, error: "forbidden" });

    who.session = { user: { id: "77777777-7777-7777-7777-777777777777", associateId: null, role: "Accounts" } };
    expect(await nricRetentionRunNow()).toEqual({ ok: false, error: "forbidden" });

    await mkRejectedAgreement(31, { applicant1Nric: "S1231231Q" });
    who.session = { user: { id: "88888888-8888-8888-8888-888888888888", associateId: null, role: "Admin" } };
    const r = await nricRetentionRunNow();
    expect(r.ok).toBe(true);
  });
});

describe("runNricRetentionOpportunistic", () => {
  it("never throws even when the underlying run fails", async () => {
    const badPrisma = { $transaction: () => { throw new Error("boom"); } };
    vi.doMock("@/lib/db", () => ({ prisma: badPrisma }));
    vi.resetModules();
    const { runNricRetentionOpportunistic: freshOpportunistic } = await import("./nric-retention");
    await expect(freshOpportunistic()).resolves.toBeUndefined();
    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });
});

describe("NRIC_RETENTION_ENABLED — default off (DevLead: the first activation needs the owner's go)", () => {
  it("the opportunistic trigger is a no-op and Run-now is refused, while Preview still works", async () => {
    await mkRejectedAgreement(31, { applicant1Nric: "S1010101A" });
    delete process.env.NRIC_RETENTION_ENABLED;
    vi.resetModules();
    const fresh = await import("./nric-retention");

    const before = await prisma.auditLog.count({ where: { action: "ashes.nric_retention_run" } });
    await fresh.runNricRetentionOpportunistic();
    expect(await prisma.auditLog.count({ where: { action: "ashes.nric_retention_run" } })).toBe(before); // no run at all

    who.session = { user: { id: "99999999-9999-9999-9999-999999999999", associateId: null, role: "Admin" } };
    expect(await fresh.nricRetentionRunNow()).toEqual({ ok: false, error: "nricRetentionDisabled" });

    const preview = await fresh.nricRetentionPreview();
    expect(preview.ok).toBe(true);
    expect(preview.counts!.inScope).toBeGreaterThanOrEqual(1); // Preview is never gated

    process.env.NRIC_RETENTION_ENABLED = "true";
    vi.resetModules();
  });
});

describe("NRIC_RETENTION_INCLUDE_LEGACY — default off", () => {
  it("leaves a Legacy row's NRIC untouched while purging an equally-old ClosedDeal row", async () => {
    const { agreementId: legacy } = await mkRejectedAgreement(31, { applicant1Nric: "S2020202B" }, "Draft", "Legacy");
    const { agreementId: closedDeal } = await mkRejectedAgreement(31, { applicant1Nric: "S3030303C" }, "Draft", "ClosedDeal");

    const r = await runNricRetention({ dryRun: false, trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(r.ran).toBe(true);

    expect((await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: legacy } })).applicant1Nric).toBe("S2020202B");
    expect((await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: closedDeal } })).applicant1Nric).toBeNull();
  });

  it("Preview reports both flows regardless of the switch", async () => {
    await mkRejectedAgreement(31, { applicant1Nric: "S1234567A" }, "Draft", "Legacy");
    await mkRejectedAgreement(31, { applicant1Nric: "S5050505E" }, "Draft", "ClosedDeal");
    const preview = await previewNricRetention();
    expect(preview.byFlow!.legacy).toBeGreaterThanOrEqual(1);
    expect(preview.byFlow!.closedDeal).toBeGreaterThanOrEqual(1);
    expect(preview.byMonth!.length).toBeGreaterThanOrEqual(1);
  });
});
