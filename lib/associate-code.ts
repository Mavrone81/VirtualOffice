import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// The associate-code sequence (EN####), in ONE place.
//
// 🔴 WHY THIS MODULE EXISTS. There were two byte-identical private copies of
// this generator — one in server/recruitment/actions.ts, one in
// server/associates/actions.ts — each reading ONLY the associate table. Two
// copies of a sequence generator is a latent drift bug on its own, and it
// became an active one the moment codes started being reserved on a Candidate
// before approval: a fix applied to one copy would leave the other handing out
// numbers already printed on a signed agreement. Consolidating is therefore not
// tidying; it is what makes the high-water mark below correct everywhere.
//
// 🔴 THE HIGH-WATER MARK HAS TWO SOURCES NOW. A code lives on an Associate once
// approved, and on a Candidate from the moment it is reserved at signing. Either
// is "already issued", so both are queried. Reading only associates would reissue
// a number that is already stamped into an immutable signed PDF.
// ---------------------------------------------------------------------------

export const SEQ_PREFIX = "EN";
export const SEQ_RE = /^EN\d+$/;

/** Attempts before giving up on a contended reservation. Each retry means another
 *  candidate won the code we proposed; with a unique index doing the arbitration
 *  that resolves in one retry per genuine collision, so this is only a bound. */
const MAX_RESERVE_ATTEMPTS = 8;

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * The next unissued code in the sequence.
 *
 *  No `orderBy` and no `take`. A FORMAT SCOPE IS NOT AN ORDERING: these are two
 *  separate properties and the sequence needs both.
 *
 *  🔴 `orderBy: { associateCode: "desc" }` is TEXT order, so "EN10000" sorts BELOW
 *  "EN9999" ('1' < '9' at the third character). Once EN10000 exists the text
 *  maximum is stuck at EN9999 forever, this proposes EN10000 on every call, and
 *  every associate creation from the 10,000th onward fails on the unique index —
 *  permanently, with no self-correction. Harmless at ten rows, free to prevent
 *  now, and expensive to discover at ten thousand.
 *
 *  Prisma cannot order by a computed expression, so the numeric maximum is taken
 *  in application code over the sequence's own rows. The payload is two short
 *  columns; at any plausible associate count that is negligible, and the real
 *  long-term answer is a dedicated Postgres sequence rather than a counter
 *  derived from a display column (see the reservation note below).
 *
 *  The query is scoped to the sequence's own prefix, and because `startsWith`
 *  narrows but cannot enforce the SHAPE ("ENX-1" still sorts in), only rows
 *  matching the sequence exactly contribute. The numeric part is read by `slice`
 *  past the prefix rather than by stripping non-digits, so a malformed code can
 *  never contribute digits to the result.
 */
export async function nextAssociateCode(): Promise<string> {
  const [associates, candidates] = await Promise.all([
    prisma.associate.findMany({
      where: { associateCode: { startsWith: SEQ_PREFIX } },
      select: { associateCode: true },
    }),
    prisma.candidate.findMany({
      where: { reservedAssociateCode: { startsWith: SEQ_PREFIX } },
      select: { reservedAssociateCode: true },
    }),
  ]);

  const issued = [
    ...associates.map((r) => r.associateCode),
    ...candidates.map((r) => r.reservedAssociateCode).filter((c): c is string => c !== null),
  ];
  const numbers = issued
    .filter((c) => SEQ_RE.test(c))
    .map((c) => parseInt(c.slice(SEQ_PREFIX.length), 10));

  // Rows exist under the prefix but none is a valid sequence code: the sequence
  // cannot be derived. Fail loudly rather than restart from 1 and collide.
  if (issued.length > 0 && numbers.length === 0) {
    throw new Error(
      `nextAssociateCode: ${issued.length} ${SEQ_PREFIX}-prefixed codes exist but none match ${SEQ_RE}; cannot derive the next code`,
    );
  }
  const n = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `${SEQ_PREFIX}${String(n).padStart(4, "0")}`;
}

/**
 * Reserve this candidate's associate code, so it exists before the agreement is
 * rendered and can be printed into the signed document.
 *
 * 🔴 WHAT MAKES THIS SAFE IS THE UNIQUE INDEX, NOT THIS FUNCTION. nextAssociateCode
 * is a read-then-compute with no lock, so two concurrent callers can and do
 * propose the same number. Before codes were reserved, the thing that stopped a
 * duplicate was `Associate.associateCode @unique`: the loser's insert failed
 * loudly and no duplicate existed. Moving allocation earlier moves that burden
 * onto `Candidate.reservedAssociateCode`, which MUST therefore be UNIQUE too —
 * without it two candidates could both reserve EN0005, both sign immutable PDFs
 * printing EN0005, and the collision would only surface at approval, after two
 * unalterable documents already carried the same number. A loud pre-document
 * failure would have become a silent duplication inside signed contracts.
 *
 * So the write is the arbiter: propose, attempt, and on a unique violation
 * recompute against the now-higher water mark and try again.
 *
 * IDEMPOTENT PER CANDIDATE, which is the other half of the safety. A candidate
 * must not be able to trigger two allocations by submitting twice (or twice at
 * once): a code already on the row is returned unchanged, and the conditional
 * `updateMany ... where reservedAssociateCode: null` means only the first writer
 * for a given candidate ever sets one. A loser re-reads and returns the winner's
 * code, so both renders print the same number as the row holds.
 *
 * Gaps are expected and accepted (the owner's ruling): a rejected or abandoned
 * candidate keeps its reserved number, and nothing reuses it. This function
 * never tries to fill a gap.
 */
export async function reserveAssociateCodeForCandidate(candidateId: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RESERVE_ATTEMPTS; attempt++) {
    const existing = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { reservedAssociateCode: true },
    });
    if (!existing) throw new Error(`reserveAssociateCodeForCandidate: candidate ${candidateId} not found`);
    if (existing.reservedAssociateCode) return existing.reservedAssociateCode;

    const code = await nextAssociateCode();
    try {
      const { count } = await prisma.candidate.updateMany({
        where: { id: candidateId, reservedAssociateCode: null },
        data: { reservedAssociateCode: code },
      });
      // count === 1: we set it. count === 0: another writer set it for this same
      // candidate between our read and our write — loop and return theirs.
      if (count === 1) return code;
    } catch (e) {
      // Another CANDIDATE took the code we proposed. Recompute and retry; the
      // water mark is now higher, so the next proposal differs.
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error(
    `reserveAssociateCodeForCandidate: could not reserve a code for ${candidateId} after ${MAX_RESERVE_ATTEMPTS} attempts`,
  );
}
