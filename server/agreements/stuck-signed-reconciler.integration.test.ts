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
  //
  // Known, accepted trade: this REQUIRES a connection pool of at least 2 —
  // the holder transaction occupies one connection for the whole test,
  // and runStuckSignedCheck's own $transaction needs a second. At
  // connection_limit=1 this would deadlock (the holder waits on
  // `holderMayRelease`, which waits on the check completing, which can't
  // get a connection) and hang to Prisma's pool timeout rather than fail
  // cleanly. Checked: neither this codebase's DATABASE_URL convention nor
  // ci-cd.yml's pins connection_limit anywhere, so Prisma's default (CPU-
  // count-based, comfortably >1 on any real runner) applies. The old
  // version's flake was an environment dependence on pool SCHEDULING; this
  // is a much smaller, deterministic (not probabilistic) dependence on
  // pool SIZE — accepted deliberately, not unexamined.
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
    // Two more failure-diagnosis paths, found in review (DevLead), fixed
    // then re-measured rather than taken on description alone — the first
    // review message overstated the second one, and the retraction is as
    // informative as the original claim.
    //
    // (1) VERIFIED, by reproducing it on the pre-fix code: if the holder's
    // own precondition (`locked` true) is false, `confirmLockHeld` never
    // fires and `await lockConfirmedHeld` below waits forever. Measured on
    // the version without this fix: 30.42s real duration (this project's
    // configured testTimeout), surfacing as an "Unhandled Rejection:
    // AssertionError: expected false to be true" with no mention of the
    // actual cause. Fixed by rejecting `lockConfirmedHeld` too, from the
    // same catch — measured after the fix: 9ms, "Error: test precondition:
    // holder failed to take the advisory lock".
    //
    // (2) NOT observed to hang, measured both ways: if
    // `expect(whileHeld.ran).toBe(false)` itself fails, the un-awaited
    // `holderTx` is simply abandoned when the test throws — vitest stops
    // awaiting the test immediately, it does not wait on every promise the
    // test ever created. Measured with the production guard neutered
    // (`if (false)` in place of the real check, forcing exactly this
    // assertion to fail): 104ms, clean `AssertionError`, no timeout, no
    // unhandled rejection, with or without the try/finally below. The
    // try/finally stays anyway, for a real reason that just isn't "it
    // would otherwise hang": it releases the lock and the holder's pool
    // connection promptly on a failing run instead of leaving them to the
    // garbage collector, which matters if a later test in this file ever
    // needs the same lock. Describing it as preventing a hang would have
    // been repeating the first review message's own overstatement into
    // committed code.
    let releaseHolder!: () => void;
    let confirmLockHeld!: () => void;
    let failLockHeld!: (e: unknown) => void;
    const holderMayRelease = new Promise<void>((resolve) => { releaseHolder = resolve; });
    const lockConfirmedHeld = new Promise<void>((resolve, reject) => { confirmLockHeld = resolve; failLockHeld = reject; });
    const holderTx = prisma.$transaction(async (db) => {
      try {
        const lock = await db.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${STUCK_CHECK_LOCK_KEY}) AS locked`;
        if (!lock[0]?.locked) throw new Error("test precondition: holder failed to take the advisory lock");
        confirmLockHeld();
      } catch (e) {
        failLockHeld(e); // the awaiter below fails WITH a reason instead of timing out
        throw e; // still rolls this transaction back
      }
      await holderMayRelease; // keep this transaction (and the lock) open until the test says so
    }, { timeout: 20_000 });
    // Explicit, because Prisma's own default transaction timeout is 5000ms
    // — far below what this test needs to hold the lock open across the
    // concurrent attempt below (a real window of ~100ms, measured). DevLead
    // reproduced the 5s default firing mid-test (a 6s injected delay after
    // lockConfirmedHeld): the holder aborts and releases the lock EARLY,
    // so the concurrent attempt legitimately succeeds and the test fails
    // with "expected true to be false" at ~6054ms — nothing in that output
    // names a timeout, so the failure accuses the lock when the real cause
    // is the holder's transaction budget. 20s is comfortably over the
    // ~100ms real window (headroom for contention, same reasoning as this
    // file's STUCK_AGE_MS) while staying under this project's 30s
    // testTimeout, so the transaction aborts before the test itself would
    // — one mechanism (remove the premature timeout), not a second one
    // layered on top to catch it after the fact.
    holderTx.catch(() => {}); // the diagnosis travels via lockConfirmedHeld; this only silences an unhandled rejection
    await lockConfirmedHeld;

    try {
      const whileHeld = await runStuckSignedCheck({ trigger: "manual", actorUserId: null, skipCooldown: true });
      expect(whileHeld.ran).toBe(false); // refused — the lock really was held, not just "probably" held
    } finally {
      releaseHolder(); // always, even when the assertion above fails — never leave the lock held past this test
      await holderTx.catch(() => {});
    }

    const afterRelease = await runStuckSignedCheck({ trigger: "manual", actorUserId: null, skipCooldown: true });
    expect(afterRelease.ran).toBe(true); // available again once the holder is gone — not permanently stuck
  });
});
