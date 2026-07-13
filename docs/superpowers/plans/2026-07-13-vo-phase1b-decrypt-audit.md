# VirtualOffice Phase 1b — PDPA decrypt-audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every decryption of C3-PII (NRIC, bank account) writes a `decrypt_pii` audit entry (actor, subject, field), and the raw decrypt can no longer be called without going through the audited helper — restoring the PDPA control that `lib/crypto.ts` and `08_Security_and_PDPA.md` §3/§10 claim but no call site honors.

**Architecture:** A new server helper `server/pii.ts` exposes `decryptPiiAudited(...)` which calls the raw decrypt and, on success, awaits `logAudit({ action: "decrypt_pii", ... })`. The raw `decryptPII` in `lib/crypto.ts` is renamed `decryptPiiRaw` so every existing call site breaks compile until migrated onto the audited helper, and any future raw use stands out in review. The two non-page call sites (`renderStatementPdf`, `buildBankFileCsv`) gain an `actorUserId` param threaded from their route handlers.

**Tech Stack:** Next.js 15.5 App Router (async RSC + route handlers), Prisma 6, Vitest, next-intl, pnpm 9 / Node 22.

## Global Constraints

- pnpm 9 / Node 22; run scripts with `pnpm exec …`. Path alias `@/*` → repo root.
- Vitest tests live under `lib/**/*.test.ts` or `server/**/*.test.ts`. When a test mocks a module referenced by a hoisted `vi.mock` factory, create the mock fns via `vi.hoisted(() => ({...}))` (a plain `const` is hoisted-after and throws "Cannot access before initialization").
- `logAudit` signature (from `lib/audit.ts`): `logAudit({ action, entityType, entityId?, before?, after?, actorUserId? }): Promise<void>` — best-effort, never throws; resolves the actor from `auth()` when `actorUserId` is `undefined`.
- Masking helpers stay: `maskNric`, `maskAccount` (they take the decrypted plaintext). The pages decrypt-then-mask, so the plaintext IS materialized → it must be audited.
- Commit to `main` locally; **do NOT push** (auto-deploys on push; ships as a batch).
- DRY / YAGNI / TDD / frequent commits.

## Call-site inventory (the complete migration set)

| Call site | PII fields | Subject | Actor source |
|---|---|---|---|
| `app/admin/associates/[id]/page.tsx` | nric, bankAccount | Associate `a.id` | `session.user.id` (page has `auth()`) |
| `app/portal/pfile/page.tsx` | nric, bankAccount | Associate `me.id` | `session.user.id` |
| `app/admin/recruitment/[id]/page.tsx` | nric, bankAccount | **Candidate** (candidate id) | `session.user.id` |
| `lib/pdf/statement.tsx` (`renderStatementPdf`) | bankAccount | Associate on the payout | new `actorUserId` param ← `app/payouts/[id]/statement/route.ts` |
| `server/payouts/bankfile.ts` (`buildBankFileCsv`) | bankAccount (per row) | each `p.associate.id` | new `actorUserId` param ← `app/admin/payouts/bank-file/route.ts` |

## File Structure

- **Create** `server/pii.ts` — `decryptPiiAudited` + `PiiField` type.
- **Create** `server/pii.test.ts` — unit tests (mock `@/lib/crypto` raw + `@/lib/audit`).
- **Modify** `lib/crypto.ts` — rename `decryptPII` → `decryptPiiRaw`.
- **Modify** the 3 pages + `lib/pdf/statement.tsx` + `app/payouts/[id]/statement/route.ts` + `server/payouts/bankfile.ts` + `app/admin/payouts/bank-file/route.ts`.

---

### Task 1: Audited decrypt helper + tests

**Files:** Create `server/pii.ts`, `server/pii.test.ts`. Modify `lib/crypto.ts` (rename export).

**Interfaces produced:**
- `type PiiField = "nric" | "bankAccount"`
- `decryptPiiAudited(opts: { blob: string | null | undefined; field: PiiField; subjectType: "Associate" | "Candidate"; subjectId: string; actorUserId?: string | null }): Promise<string | null>`

Behaviour: `null`/empty blob → return `null`, no audit. Raw decrypt throws → return `null`, no audit. Success → await `logAudit({ action: "decrypt_pii", entityType: subjectType, entityId: subjectId, after: { field }, actorUserId })` then return the plaintext.

- [ ] **Step 1: Rename the raw export** in `lib/crypto.ts`: `export function decryptPII(` → `export function decryptPiiRaw(`. (Leave `encryptPII`, `maskNric`, `maskAccount` unchanged. This breaks the 5 call sites' compile until Tasks 2-4 migrate them — expected.)

- [ ] **Step 2: Write the failing test** `server/pii.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { decryptRawMock, logAuditMock } = vi.hoisted(() => ({
  decryptRawMock: vi.fn(),
  logAuditMock: vi.fn(),
}));
vi.mock("@/lib/crypto", () => ({ decryptPiiRaw: decryptRawMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { decryptPiiAudited } from "@/server/pii";

beforeEach(() => {
  decryptRawMock.mockReset();
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined);
});

describe("decryptPiiAudited", () => {
  it("returns null and does not audit when the blob is empty", async () => {
    expect(await decryptPiiAudited({ blob: null, field: "nric", subjectType: "Associate", subjectId: "a1" })).toBeNull();
    expect(decryptRawMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("decrypts and writes one decrypt_pii audit row on success", async () => {
    decryptRawMock.mockReturnValue("S1234567D");
    const out = await decryptPiiAudited({
      blob: "v1:x", field: "nric", subjectType: "Associate", subjectId: "a1", actorUserId: "u9",
    });
    expect(out).toBe("S1234567D");
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: "decrypt_pii", entityType: "Associate", entityId: "a1",
      after: { field: "nric" }, actorUserId: "u9",
    });
  });

  it("returns null and does not audit when the raw decrypt throws", async () => {
    decryptRawMock.mockImplementation(() => { throw new Error("bad ciphertext"); });
    expect(await decryptPiiAudited({ blob: "v1:bad", field: "bankAccount", subjectType: "Candidate", subjectId: "c1" })).toBeNull();
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run → RED** (`pnpm exec vitest run server/pii.test.ts`; fails — module missing).

- [ ] **Step 4: Implement** `server/pii.ts`:

```ts
import { decryptPiiRaw } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

export type PiiField = "nric" | "bankAccount";

/**
 * Decrypt a C3-PII field and record a `decrypt_pii` audit entry. Returns null
 * (without auditing) when there is nothing to decrypt or the ciphertext is bad,
 * so it drops in wherever the old `safeDecrypt(blob)` helpers were used.
 */
export async function decryptPiiAudited(opts: {
  blob: string | null | undefined;
  field: PiiField;
  subjectType: "Associate" | "Candidate";
  subjectId: string;
  actorUserId?: string | null;
}): Promise<string | null> {
  if (!opts.blob) return null;
  let value: string;
  try {
    value = decryptPiiRaw(opts.blob);
  } catch {
    return null;
  }
  await logAudit({
    action: "decrypt_pii",
    entityType: opts.subjectType,
    entityId: opts.subjectId,
    after: { field: opts.field },
    actorUserId: opts.actorUserId,
  });
  return value;
}
```

- [ ] **Step 5: Run → GREEN** (`pnpm exec vitest run server/pii.test.ts`, 3/3). Do NOT run `tsc` yet — the 5 unmigrated call sites still reference the renamed `decryptPII` and will fail tsc until Tasks 2-4 land. Commit is deferred to Task 4 (the rename + migrations are one atomic compile unit); alternatively commit the helper + rename together here only if `tsc` is scoped — simplest: **commit after Task 4** when the whole tree compiles. Mark this task done once 3/3 green.

---

### Task 2: Migrate the three RSC pages

**Files:** `app/admin/associates/[id]/page.tsx`, `app/portal/pfile/page.tsx`, `app/admin/recruitment/[id]/page.tsx`.

For each page: delete its local `safeDecrypt` function; change the crypto import to drop `decryptPII` (keep `maskNric`/`maskAccount`); add `import { decryptPiiAudited } from "@/server/pii";`. After the record is fetched and `session` is resolved, compute awaited consts and use them where `safeDecrypt(...)` was called.

- [ ] **Step 1: `app/admin/associates/[id]/page.tsx`** — after `if (!a) notFound();` add:

```ts
const actorUserId = session?.user.id ?? null;
const nricPlain = await decryptPiiAudited({ blob: a.nric, field: "nric", subjectType: "Associate", subjectId: a.id, actorUserId });
const bankAcctPlain = await decryptPiiAudited({ blob: a.bankAccountNumber, field: "bankAccount", subjectType: "Associate", subjectId: a.id, actorUserId });
```

Replace `maskAccount(safeDecrypt(a.bankAccountNumber))` → `maskAccount(bankAcctPlain)` and `maskNric(safeDecrypt(a.nric))` → `maskNric(nricPlain)`. Remove the local `safeDecrypt`.

- [ ] **Step 2: `app/portal/pfile/page.tsx`** — same pattern; subject is the viewing associate (`me.id`), `actorUserId = session?.user.id ?? null`. Fields: `me.nric`, `me.bankAccountNumber`. (Self-access is still audited.)

- [ ] **Step 3: `app/admin/recruitment/[id]/page.tsx`** — same pattern but `subjectType: "Candidate"`, `subjectId` = the candidate's id (the `p` record's id — confirm the field name in the file), `actorUserId = session?.user.id ?? null`. Fields: `p.nric`, `p.bankAccountNumber`.

- [ ] **Step 4:** Do not run full `tsc` yet (statement/bankfile still unmigrated). Grep-verify none of these 3 files still import or call `decryptPII`/`safeDecrypt`.

---

### Task 3: Migrate the statement PDF (actor-threaded)

**Files:** `lib/pdf/statement.tsx`, `app/payouts/[id]/statement/route.ts`.

- [ ] **Step 1:** In `lib/pdf/statement.tsx`, change the signature to `renderStatementPdf(payoutId: string, actorUserId?: string | null)`. Delete the local `safeDecrypt`; drop `decryptPII` from the crypto import (keep `maskAccount`); add `import { decryptPiiAudited } from "@/server/pii";`. Where the bank account is decrypted (~line 166), replace with an awaited call using the payout's associate id as subject:

```ts
const acct = await decryptPiiAudited({
  blob: payout.bankAccountNumber, field: "bankAccount",
  subjectType: "Associate", subjectId: payout.associateId, actorUserId,
});
```

(Confirm the exact field for the associate id on the `payout` object — it is the `associateId` foreign key or `payout.associate.id`; use whichever the query selects.)

- [ ] **Step 2:** In `app/payouts/[id]/statement/route.ts`, resolve the actor from the existing `auth()` in that handler and pass it: `renderStatementPdf(id, session?.user?.id ?? null)`.

- [ ] **Step 3:** Grep-verify no `decryptPII`/`safeDecrypt` left in these two files.

---

### Task 4: Migrate the bank file (actor-threaded) + verify whole tree

**Files:** `server/payouts/bankfile.ts`, `app/admin/payouts/bank-file/route.ts`.

- [ ] **Step 1:** In `server/payouts/bankfile.ts`, change the signature to `buildBankFileCsv(month: string, actorUserId?: string | null)`; drop the `decryptPII` import; add `import { decryptPiiAudited } from "@/server/pii";`. Replace the try/catch decrypt in the loop with:

```ts
if (p.paymentMethod === "BankTransfer" && p.bankAccountNumber) {
  account = (await decryptPiiAudited({
    blob: p.bankAccountNumber, field: "bankAccount",
    subjectType: "Associate", subjectId: p.associate.id, actorUserId,
  })) ?? "(decrypt-failed)";
}
```

- [ ] **Step 2:** In `app/admin/payouts/bank-file/route.ts`, pass the actor from that handler's `auth()`: `buildBankFileCsv(month, session?.user?.id ?? null)`.

- [ ] **Step 3: Whole-tree verify:** `pnpm exec tsc --noEmit` (clean — every call site migrated) and `pnpm exec vitest run` (all suites green incl. the new pii tests).

- [ ] **Step 4: Enforcement grep (acceptance):** `grep -rn 'decryptPiiRaw' --include='*.ts' --include='*.tsx' . | grep -v node_modules` returns ONLY `lib/crypto.ts` (definition) and `server/pii.ts` (sole caller). `grep -rn 'decryptPII\b'` returns nothing. `grep -rn 'safeDecrypt'` returns nothing.

- [ ] **Step 5: Commit** the whole change (helper + rename + all migrations compile together):

```bash
git add server/pii.ts server/pii.test.ts lib/crypto.ts app/admin/associates lib/pdf/statement.tsx app/payouts server/payouts/bankfile.ts app/admin/payouts/bank-file app/portal/pfile app/admin/recruitment
git commit -m "pii: audit every decrypt_pii access; route all decrypts through server/pii"
```

---

## Acceptance criteria

1. `decryptPiiAudited` writes exactly one `decrypt_pii` audit row per successful decrypt, with `entityType`/`entityId` = the subject and `after.field` = the field; no audit on empty/failed.
2. All 5 call sites materialize PII only via `decryptPiiAudited`; `decryptPiiRaw` is imported only by `server/pii.ts`; no `decryptPII`/`safeDecrypt` remain.
3. `tsc --noEmit` clean; full Vitest suite green including 3 new pii tests.
4. Bank-file and statement routes thread the real actor; page views audit against the viewing user.

## Self-review notes

- Actor on the pages is `session.user.id`; if a page ever renders without a session it would already have redirected via middleware, so `?? null` is a safe floor (audit still records the access with a null actor rather than crashing).
- Auditing decrypt-to-mask views is intentional (plaintext is materialized). If audit-noise becomes a concern later, revisit — out of scope here.
- `logAudit` is best-effort/never-throws, so an audit failure cannot break a page render or a payout file — the `await` only orders the write, it can't propagate an error.
