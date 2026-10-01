// N2 residual: detects a PetsAshesAgreement stuck at Signed with no
// agreementPdfKey (a crash between the sign CAS and the pdfKey
// transaction). Alert only: this suite asserts the row is NEVER written —
// the one thing a careless "helpful" refactor would most likely add. Real
// throwaway Postgres.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { detectStuckSignedAgreements, runStuckSignedCheck, STUCK_CHECK_LOCK_KEY } from "./stuck-signed-reconciler";

const TAG = "N2STUCK-";
let closerId = "";
const submissionIds: string[] = [];

async function mkAgreement(status: "Draft" | "Signed" | "Superseded", opts: { signedAgeMs?: number; pdfKey?: string | null } = {}) {
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2026-01-01"), clientName: TAG + "Client", saleAmount: 1000,
      paymentPlan: "FullPayment" as never, amountCollected: 0, closingAssociateId: closerId,
    },
    select: { id: true },
  });
  submissionIds.push(sub.id);
  const signedAt = status !== "Draft" ? new Date(Date.now() - (opts.signedAgeMs ?? 0)) : null;
  const agreement = await prisma.petsAshesAgreement.create({
    data: {
      submissionId: sub.id, applicant1Name: TAG + "Applicant", amountNumeric: 1000, amountWords: "One Thousand",
      paymentPlan: "FullPayment" as never, status: status as never,
      applicantSignatureKey: status !== "Draft" ? `submissions/${sub.id}/sig.png` : null,
      signedAt,
      agreementPdfKey: opts.pdfKey === undefined ? (status !== "Draft" ? `submissions/${sub.id}/agreement.pdf` : null) : opts.pdfKey,
      signedPdfSha256: status !== "Draft" && opts.pdfKey !== null ? "b".repeat(64) : null,
    },
  });
  return { sub, agreement };
}

beforeAll(async () => {
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  // audit_log is append-only (DB trigger refuses DELETE) — its rows from
  // this suite are left in place, same as every other audited test here.
  await prisma.petsAshesAgreement.deleteMany({ where: { submissionId: { in: submissionIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: submissionIds } } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
});

const TEN_MIN = 10 * 60 * 1000;

describe("detectStuckSignedAgreements", () => {
  it("finds a Signed row with no agreementPdfKey, signed well past the threshold", async () => {
    const { agreement } = await mkAgreement("Signed", { signedAgeMs: TEN_MIN + 60_000, pdfKey: null });
    const stuck = await detectStuckSignedAgreements();
    expect(stuck.map((s) => s.id)).toContain(agreement.id);
    const found = stuck.find((s) => s.id === agreement.id)!;
    expect(found.ageMs).toBeGreaterThanOrEqual(TEN_MIN);
  });

  it("does NOT flag a Signed row with no agreementPdfKey that is still within the threshold (a healthy in-flight sign)", async () => {
    const { agreement } = await mkAgreement("Signed", { signedAgeMs: 5_000, pdfKey: null });
    const stuck = await detectStuckSignedAgreements();
    expect(stuck.map((s) => s.id)).not.toContain(agreement.id);
  });

  it("does NOT flag a Signed row that has its agreementPdfKey — the normal, successful case", async () => {
    const { agreement } = await mkAgreement("Signed", { signedAgeMs: TEN_MIN + 60_000 }); // pdfKey set by default
    const stuck = await detectStuckSignedAgreements();
    expect(stuck.map((s) => s.id)).not.toContain(agreement.id);
  });

  it("does NOT flag a Draft row (never signed, agreementPdfKey legitimately null)", async () => {
    const { agreement } = await mkAgreement("Draft");
    const stuck = await detectStuckSignedAgreements();
    expect(stuck.map((s) => s.id)).not.toContain(agreement.id);
  });

  it("does NOT flag a Superseded row even with no agreementPdfKey — the spec is status = Signed exactly, not 'anything non-Draft'", async () => {
    const { agreement } = await mkAgreement("Superseded", { signedAgeMs: TEN_MIN + 60_000, pdfKey: null });
    const stuck = await detectStuckSignedAgreements();
    expect(stuck.map((s) => s.id)).not.toContain(agreement.id);
  });
});

describe("runStuckSignedCheck — alert only, never writes to the row", () => {
  it("the check writes NOTHING to the PetsAshesAgreement row itself — only an audit entry", async () => {
    const { agreement } = await mkAgreement("Signed", { signedAgeMs: TEN_MIN + 60_000, pdfKey: null });
    const before = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: agreement.id } });

    const r = await runStuckSignedCheck({ trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(r.ran).toBe(true);
    expect(r.stuck?.map((s) => s.id)).toContain(agreement.id);

    const after = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
    // Every field, unchanged — the deliverable. status stays Signed (never
    // reverted to Draft), agreementPdfKey stays null (never silently
    // backfilled), signedPdfSha256 never touched, updatedAt unmoved.
    expect(after).toEqual(before);
  });

  it("writes exactly one ashes.stuck_signed_detected audit entry per run, with the count and ids, never PII", async () => {
    const { agreement } = await mkAgreement("Signed", { signedAgeMs: TEN_MIN + 60_000, pdfKey: null });
    await runStuckSignedCheck({ trigger: "manual", actorUserId: null, skipCooldown: true });

    const entries = await prisma.auditLog.findMany({ where: { action: "ashes.stuck_signed_detected" }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(entries).toHaveLength(1);
    const after = entries[0].afterJson as { trigger: string; count: number; ids: string[] };
    expect(after.trigger).toBe("manual");
    expect(after.ids).toContain(agreement.id);
    expect(after.count).toBeGreaterThanOrEqual(1);
  });

  it("a second run within the cooldown is a no-op (ran: false); skipCooldown bypasses it", async () => {
    await runStuckSignedCheck({ trigger: "manual", actorUserId: null, skipCooldown: true });
    const second = await runStuckSignedCheck({ trigger: "manual", actorUserId: null }); // no skipCooldown
    expect(second.ran).toBe(false);

    const third = await runStuckSignedCheck({ trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(third.ran).toBe(true);
  });

  // NOT `Promise.all([runStuckSignedCheck(), runStuckSignedCheck()])`: that
  // version raced the connection pool, not the lock. `$transaction`
  // acquires a connection lazily, and a pool with a free connection at the
  // time can run the two interactive transactions one after the other —
  // the first commits (releasing the lock) before the second even opens.
  // Both see `locked: true` then, and the test fails non-deterministically
  // depending on pool/scheduling timing invisible from the test (measured:
  // 10 standalone runs of that version gave 6 pass / 4 fail). This version
  // holds the SAME lock key deterministically open in its own transaction
  // first, so a concurrent attempt is GUARANTEED to find it held — no race
  // on wall-clock timing, testing the actual property ("refused while
  // held, available once released") rather than hoping two promises
  // overlap at the database level.
  it("a concurrent run is refused while another genuinely holds the lock, and succeeds once it's released", async () => {
    // `const holderTx = prisma.$transaction(fn)` returns immediately — it
    // does NOT block until `fn` has run BEGIN and taken the lock. The first
    // version of this fix called runStuckSignedCheck right after that
    // assignment with no await on anything confirming the lock was
    // actually held yet, so it raced connection/query latency instead of
    // the pool — same bug, moved one level down (measured: still 3/10
    // failed standalone, `whileHeld.ran` coming back `true`). This version
    // waits on an explicit signal the holder resolves ONLY after its own
    // `pg_try_advisory_xact_lock` call has returned `locked: true` — a
    // fact, not an elapsed-time guess.
    let releaseHolder!: () => void;
    let confirmLockHeld!: () => void;
    const holderMayRelease = new Promise<void>((resolve) => { releaseHolder = resolve; });
    const lockConfirmedHeld = new Promise<void>((resolve) => { confirmLockHeld = resolve; });
    const holderTx = prisma.$transaction(async (db) => {
      const lock = await db.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${STUCK_CHECK_LOCK_KEY}) AS locked`;
      expect(lock[0]?.locked).toBe(true);
      confirmLockHeld();
      await holderMayRelease; // keep this transaction (and the lock) open until the test says so
    });
    await lockConfirmedHeld;

    const whileHeld = await runStuckSignedCheck({ trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(whileHeld.ran).toBe(false); // refused — the lock really was held, not just "probably" held

    releaseHolder();
    await holderTx; // commit, releasing the advisory lock

    const afterRelease = await runStuckSignedCheck({ trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(afterRelease.ran).toBe(true); // available again once the holder is gone — not permanently stuck
  });
});
