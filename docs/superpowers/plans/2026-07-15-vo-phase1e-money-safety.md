# VirtualOffice Phase 1e — §4.4 Money-Safety Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the §4.4 money-safety holes — a Paid payout can't revert or re-process, transaction numbering can't race into duplicates, and the bank/GIRO file can't be generated without a fresh password re-auth (audited).

**Architecture:** A payout status state machine guards `setPayoutStatus`; the racy `count()+1` transaction code is replaced with a Postgres sequence; a `reauth()` primitive (argon2 verify) gates bank-file generation, which moves from a plain GET download link to a password-confirmed server action.

**Tech Stack:** Next.js 15.5 · Prisma 6.19 · Auth.js v5 · `@node-rs/argon2` · Postgres · Vitest 4 · pnpm.

## Global Constraints

- Branch `main`; **commit directly to main, do NOT push** (user pushes explicitly; push auto-deploys via GitHub Actions).
- **Dev/test DB:** `export DATABASE_URL='postgresql://postgres:devpass@127.0.0.1:5434/virtualoffice'` (container `vo-dev-pg`, port 5434). New migrations via `pnpm prisma migrate dev`; scratch DB is disposable (reset OK), NEVER prod.
- **Prisma convention:** models PascalCase `@@map("snake_case")`, camelCase fields `@map`, PK `@id @default(uuid()) @db.Uuid`.
- **Migrations on push are MANUAL, migrate-deploy-ONLY (never `db seed`)** — a raw SQL migration (e.g. `CREATE SEQUENCE`) is applied the same way.
- **Error contract:** server actions return `{ ok:false, error: <i18n> }` via `getTranslations("errors")`; new keys go in BOTH `messages/en.json` and `messages/zh-CN.json` (parity enforced — 807 keys currently, keep them equal).
- **Existing RBAC preserved:** `getAdminPrincipal()` / `getPrincipal()` (Phase 1a service layer, `lib/access.ts`) guards stay; money-safety is additive.
- **CI now has a Postgres service** (added 2026-07-15) — DB-integration tests run in CI. New integration tests are fine.
- **TDD**; colocated `*.test.ts`; full suite + `pnpm tsc --noEmit` + `pnpm lint` green before each commit.
- **Commit trailer (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EvKLWJaD5mh77pk9qK4hAf
  ```
  `git -c user.email="samuel.fu@rmagroup.com.sg" -c user.name="Samuel Fu"`.

---

## File Structure

```
server/payouts/actions.ts     # MODIFY — setPayoutStatus state machine
server/sales/actions.ts       # MODIFY — TXN code via nextval sequence (line ~99-101)
prisma/migrations/<ts>_add_transaction_code_seq/migration.sql  # NEW — CREATE SEQUENCE
lib/reauth.ts                 # NEW — reauth(userId, password): argon2 verify
server/payouts/bankfile.ts    # (unchanged builder) 
server/payouts/actions.ts     # MODIFY — new generateBankFile(month, password) gated action (or a new file server/payouts/bankfile-action.ts)
app/admin/payouts/bank-file/route.ts  # MODIFY or REMOVE — no longer an unauthenticated-by-password GET; see Task 3
app/admin/payouts/payout-actions.tsx  # MODIFY — password-confirm before bank file (Task 4)
messages/en.json, messages/zh-CN.json # MODIFY — new keys
Tests: server/payouts/state-machine.test.ts, server/sales/txn-sequence.test.ts, lib/reauth.test.ts, server/payouts/bankfile-reauth.test.ts
```

---

## Task 1: Paid-row state machine on `setPayoutStatus`

**Files:** Modify `server/payouts/actions.ts`; Test `server/payouts/state-machine.test.ts`

**Context:** `setPayoutStatus(payoutId, "Approved"|"Paid")` currently updates with NO current-status check — a `Paid` row can be set back to `Approved`, or re-set to `Paid` (re-processed). `PayoutStatus` enum = `Pending | Approved | Paid | Cancelled`.

**Interfaces:**
- Produces: `setPayoutStatus` enforces transitions `Pending→Approved`, `Approved→Paid` (and idempotent same-state is rejected as illegal). `Paid` is terminal (no transition out). Illegal transition → `{ ok:false, error: t("illegalPayoutTransition") }`. Reads current status first.

- [ ] **Step 1: Failing test**

```ts
// server/payouts/state-machine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const payout = { current: "Paid" as string };
vi.mock("@/lib/db", () => ({ prisma: {
  monthlyPayout: {
    findUnique: vi.fn(async () => ({ id: "p1", payoutStatus: payout.current })),
    update: vi.fn(async () => ({ id: "p1" })),
  },
}}));
vi.mock("@/lib/access", () => ({ getAdminPrincipal: async () => ({ userId: "u1", role: "Admin" }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
import { setPayoutStatus } from "./actions";
import { prisma } from "@/lib/db";
beforeEach(() => vi.clearAllMocks());
describe("setPayoutStatus state machine", () => {
  it("rejects transition out of Paid (terminal) and does not update", async () => {
    payout.current = "Paid";
    const r = await setPayoutStatus("p1", "Approved");
    expect(r).toEqual({ ok: false, error: "illegalPayoutTransition" });
    expect(prisma.monthlyPayout.update).not.toHaveBeenCalled();
  });
  it("allows Approved -> Paid", async () => {
    payout.current = "Approved";
    const r = await setPayoutStatus("p1", "Paid");
    expect(r.ok).toBe(true);
    expect(prisma.monthlyPayout.update).toHaveBeenCalledOnce();
  });
  it("rejects Pending -> Paid (must go via Approved)", async () => {
    payout.current = "Pending";
    const r = await setPayoutStatus("p1", "Paid");
    expect(r).toEqual({ ok: false, error: "illegalPayoutTransition" });
  });
});
```

- [ ] **Step 2: Run — FAIL** (`pnpm vitest run server/payouts/state-machine.test.ts`).

- [ ] **Step 3: Implement** — in `setPayoutStatus`, after the `getAdminPrincipal()` guard: read `const cur = await prisma.monthlyPayout.findUnique({ where:{id:payoutId}, select:{ payoutStatus:true }});` (→ `t("notFound")` if null). Define allowed map: `Pending→Approved`, `Approved→Paid`. Compute target (`status==="Paid"?Paid:Approved`). If `cur.payoutStatus` is `Paid` (terminal) OR the `(cur → target)` pair isn't in the allowed set → return `{ ok:false, error: t("illegalPayoutTransition") }`. Otherwise do the existing update + audit. Add `illegalPayoutTransition` + `notFound` (if not present) to both message files.

- [ ] **Step 4: Run — PASS** + full suite. **Step 5: Commit** — `feat(money): payout Paid-terminal state machine on setPayoutStatus`.

---

## Task 2: Transaction-code numbering via Postgres sequence (kills count()+1 race)

**Files:** Modify `server/sales/actions.ts`; Create `prisma/migrations/<ts>_add_transaction_code_seq/migration.sql`; Test `server/sales/txn-sequence.test.ts`

**Context:** `server/sales/actions.ts:99-101` inside `verifySubmission`'s `$transaction`: `const n = await db.salesTransaction.count(); const code = TXN-${n+1}`. Two concurrent verifications both count N → both emit `TXN-{N+1}` → duplicate codes. (NOTE: invoice numbering is already atomic via `Company.invoiceNextSeq { increment:1 }` — do NOT change that; only the TXN code is racy.)

**Interfaces:** After this task, the TXN code derives from `nextval('transaction_code_seq')` — concurrency-safe (Postgres sequences serialize nextval; gaps on rollback are acceptable for a code).

- [ ] **Step 1: Migration** — create `prisma/migrations/<timestamp>_add_transaction_code_seq/migration.sql` with:
```sql
-- Concurrency-safe transaction code counter (replaces count()+1 race).
CREATE SEQUENCE IF NOT EXISTS transaction_code_seq START 1;
-- Seed the sequence past any existing TXN codes so we don't collide with historical data.
SELECT setval('transaction_code_seq', COALESCE((SELECT COUNT(*) FROM sales_transactions), 0) + 1, false);
```
(Confirm the real table name for `SalesTransaction` via its `@@map` in schema.prisma — use that exact name in the `SELECT COUNT` / adjust if different. If the model has no `@@map`, Prisma's default is the model name; verify with `\dt` on the dev DB.) Create the folder + file manually (raw SQL, no schema model change), then `pnpm prisma migrate deploy` on the dev DB to apply + record it. Verify `\d transaction_code_seq` exists.

- [ ] **Step 2: Failing test (integration, real dev DB)**

```ts
// server/sales/txn-sequence.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { nextTransactionCode } from "./actions"; // exported helper (Step 3)
describe("nextTransactionCode", () => {
  it("returns unique, monotonic codes under concurrency (no duplicates)", async () => {
    const codes = await Promise.all(Array.from({ length: 20 }, () => nextTransactionCode(prisma)));
    expect(new Set(codes).size).toBe(20);           // all unique
    expect(codes.every((c) => /^TXN-\d{4,}$/.test(c))).toBe(true);
  });
});
```

- [ ] **Step 3: Implement** — add and export a helper in `server/sales/actions.ts`:
```ts
export async function nextTransactionCode(db: Prisma.TransactionClient | typeof prisma): Promise<string> {
  const rows = await db.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('transaction_code_seq')`;
  const n = Number(rows[0].nextval);
  return `TXN-${String(n).padStart(4, "0")}`;
}
```
Then in `verifySubmission`'s `$transaction`, replace `const n = await db.salesTransaction.count(); const code = ...` with `const code = await nextTransactionCode(db);`. (Keep everything else identical.)

- [ ] **Step 4: Run — PASS** + full suite. **Step 5: Commit** — `feat(money): TXN code via Postgres sequence (fix count()+1 race)`.

---

## Task 3: `reauth()` helper + bank-file generation gated by password re-auth (audited)

**Files:** Create `lib/reauth.ts`, `lib/reauth.test.ts`; Modify `server/payouts/actions.ts` (new `generateBankFile` action) + `app/admin/payouts/bank-file/route.ts`; Test `server/payouts/bankfile-reauth.test.ts`

**Context:** The bank/GIRO CSV (`buildBankFileCsv(month, actorUserId)`) is currently downloaded via a plain GET link `app/admin/payouts/bank-file/route.ts` (triggered by `<a href>` in `payout-actions.tsx`). §4.4 requires a fresh password re-entry immediately before money leaves + an audit row. This means the bank-file trigger must become a **password-confirmed action**, not a bare GET link.

**Interfaces:**
- Produces `lib/reauth.ts`: `reauth(userId: string, password: string): Promise<boolean>` — loads the user's `passwordHash`, `verify()` (argon2) against `password`, returns bool. Returns false on missing user/hash. Never throws on a bad password.
- Produces `generateBankFile(month: string, password: string): Promise<{ ok:true; csv:string } | { ok:false; error:string }>` in `server/payouts/actions.ts` — `getAdminPrincipal()` gate → `reauth(principal.userId, password)` (→ `t("reauthFailed")` if false) → `buildBankFileCsv(month, principal.userId)` → `logAudit({action:"payout.bankfile_generated", entityType:"MonthlyPayout", entityId:month})` → return the CSV string. The old GET route either delegates to this (requires the password as a POST field) or is removed in favor of the action (Task 4 wires the UI).

- [ ] **Step 1: reauth test**

```ts
// lib/reauth.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn(async ({ where }) =>
  where.id === "good" ? { passwordHash: "HASH" } : null) } } }));
vi.mock("@node-rs/argon2", () => ({ verify: vi.fn(async (_h: string, p: string) => p === "correct") }));
import { reauth } from "./reauth";
describe("reauth", () => {
  it("true only for the correct password", async () => {
    expect(await reauth("good", "correct")).toBe(true);
    expect(await reauth("good", "wrong")).toBe(false);
  });
  it("false for unknown user, no throw", async () => {
    expect(await reauth("missing", "correct")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement `lib/reauth.ts`**

```ts
import { prisma } from "@/lib/db";
import { verify } from "@node-rs/argon2";
export async function reauth(userId: string, password: string): Promise<boolean> {
  if (!password) return false;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!u?.passwordHash) return false;
  try { return await verify(u.passwordHash, password); } catch { return false; }
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: `generateBankFile` action test** (`server/payouts/bankfile-reauth.test.ts`): mock `@/lib/access` (admin principal), `@/lib/reauth` (reauth → false then true), `@/server/payouts/bankfile` (buildBankFileCsv → "CSVDATA"), `@/lib/audit`. Assert: bad password → `{ ok:false, error:"reauthFailed" }` and `buildBankFileCsv` NOT called + no audit; good password → `{ ok:true, csv:"CSVDATA" }` and audit written. Run — FAIL.

- [ ] **Step 6: Implement `generateBankFile`** in `server/payouts/actions.ts` per the interface. Update `app/admin/payouts/bank-file/route.ts` to a **POST** handler that reads `month` + `password` (form/JSON body), calls `generateBankFile`, and streams the CSV with `Content-Type: text/csv` + `Content-Disposition` on success, or returns 403 with the error on `reauthFailed`. Add `reauthFailed` to both message files (EN "Password confirmation failed.", ZH "密码确认失败。"). Run — PASS + full suite.

- [ ] **Step 7: Commit** — `feat(money): reauth-gated + audited bank-file generation`.

---

## Task 4: Password-confirm UI for bank-file download

**Files:** Modify `app/admin/payouts/payout-actions.tsx` (and add a small client confirm component if needed).

**Context:** `payout-actions.tsx:38` currently renders a bare `<a href="/admin/payouts/bank-file?month=...">`. Replace with a control that collects the admin's password and POSTs it to the Task-3 route, then triggers the CSV download from the response.

- [ ] **Step 1:** Replace the `<a>` with a button that opens a small inline password prompt (a `<form>` or a minimal modal — match existing UI primitives). On submit: `fetch("/admin/payouts/bank-file", { method:"POST", body: form with month+password })`; on 200, read the blob and trigger a client download (`URL.createObjectURL` → `<a download>` click); on 403, show the `reauthFailed` message inline. Mobile-responsive, ≥44px targets, EzyHR theme (match the existing page).
- [ ] **Step 2: Manual verify** with `pnpm dev`: wrong password → inline error, no download; correct password → CSV downloads. `pnpm tsc --noEmit` + `pnpm lint` green.
- [ ] **Step 3: Commit** — `feat(money): password-confirm UI before bank-file download`.

---

## Self-Review Notes (completed)

- **Spec §4.4 coverage:** Paid-row lock/state-machine (T1); numbering race → sequence (T2, correctly targeting the TXN `count()+1`, not the already-atomic invoice counter); re-auth before bank file + audit (T3) + its UI (T4). All §4.4 items covered.
- **Type/interface consistency:** `nextTransactionCode(db)` (T2) used in verifySubmission; `reauth(userId,password)` (T3) used by `generateBankFile`; `generateBankFile(month,password)` (T3) used by the route + UI (T4). Consistent.
- **Design note (flag to user):** T3/T4 change the bank-file UX from a one-click GET link to a password-confirmed download. This is intentional (money-leaving control) but is a visible admin workflow change — call it out at review.
- **Deploy note:** T2 adds a raw-SQL `CREATE SEQUENCE` migration → on push, apply migrate-deploy-ONLY (no seed), same as the rate-limit migration.
