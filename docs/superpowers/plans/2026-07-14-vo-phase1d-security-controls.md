# VirtualOffice Phase 1d — §4.2 Security Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining §4.2 security gaps — zod input validation before every write, DB-backed rate-limiting/lockout on auth + public endpoints, and magic-byte upload validation.

**Architecture:** Centralized zod schemas validated at each server-action/route boundary before any DB access. A DB-backed attempt-counter table (`RateLimitAttempt`) with a sliding window + lockout, checked by a small `lib/rate-limit.ts` service on login / password-reset / public onboarding + e-sign. Uploads sniffed by real magic bytes (`lib/file-type.ts`) instead of the browser-supplied MIME.

**Tech Stack:** Next.js 15.5 · Prisma 6.19 · Auth.js v5 (`next-auth@5.0.0-beta.31`) · **zod v4** (`^4.4.3`, already a dep) · `@node-rs/argon2` · Vitest 4 · pnpm.

## Global Constraints

- **zod is v4** (`^4.4.3`). Use v4 API (`z.object`, `z.string().max()`, `z.coerce.number()`, `schema.safeParse()` → `{success, data|error}`; `z.enum([...])`). Do NOT use removed v3-only APIs.
- **Prisma convention:** models PascalCase with `@@map("snake_case")`; fields camelCase (add `@map` where the column is snake_case). New model → new migration folder `prisma/migrations/<timestamp>_<name>/migration.sql`; generate via `pnpm prisma migrate dev --name <name>` against the **local dev DB** (`DATABASE_URL=postgresql://postgres:devpass@127.0.0.1:5433/virtualoffice` — spin one if absent). Never run migrations against prod here.
- **Error contract:** server actions return `{ ok: false, error: <i18n string> }` using `getTranslations("errors")` (existing pattern). Add new keys to BOTH `messages/en.json` and `messages/zh-CN.json` (full parity — the app enforces it). Validation failures return `{ ok:false, error: t("invalidInput") }` (add this key) — do NOT leak raw zod messages to the client.
- **Validation happens BEFORE any DB read/write** and before the existing manual guards; keep the existing `requireAdmin()`/`auth()` RBAC checks (validation is additive, not a replacement).
- **Rate-limit is DB-backed** (survives restart, multi-instance-safe) — NOT in-memory, NOT Redis. Fail **open** on a rate-limiter *infrastructure* error (DB down) but log loudly; fail **closed** (block) when the limit is actually exceeded.
- **Upload validation:** sniff the actual bytes; allow-list **PNG/JPEG** for photos, **PDF** for agreements/documents. Reject on mismatch with an i18n error. Keep existing size caps.
- **TDD:** every task writes the failing test first. Colocated `*.test.ts`, run with `pnpm vitest run <file>`. Full suite green before each commit (`pnpm vitest run` + `pnpm tsc --noEmit` + `pnpm lint`).
- **Commit trailer (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EvKLWJaD5mh77pk9qK4hAf
  ```
  Use `git -c user.email="samuel.fu@rmagroup.com.sg" -c user.name="Samuel Fu"`.
- **Branch/push:** commit directly to `main`, **do NOT push** (user pushes explicitly; push auto-deploys via GitHub Actions, and the new migration must then be applied on prod migrate-deploy-ONLY, no seed).

---

## File Structure

```
lib/
  schemas.ts          # NEW — all zod input schemas (sale, associate, product, comCode, onboarding) + inferred types
  validate.ts         # NEW — validate(schema, input) -> {ok:true,data} | {ok:false}
  rate-limit.ts       # NEW — DB-backed attempt counter: checkRateLimit(identifier, action) + recordFailure/reset
  file-type.ts        # NEW — sniffFileType(bytes) -> 'png'|'jpeg'|'pdf'|null ; assertUpload(bytes, allow[])
  storage.ts          # MODIFY — imageExt stays; callers switch to sniff
prisma/
  schema.prisma       # MODIFY — add model RateLimitAttempt
  migrations/<ts>_add_rate_limit_attempt/migration.sql  # NEW
server/
  sales/actions.ts        # MODIFY — validate SubmitSaleInput in submitSale
  associates/actions.ts   # MODIFY — validate NewAssociateInput in createAssociate
  products/actions.ts     # MODIFY — validate ProductInput/comCode in createProduct/changeRates/addComCode
  recruitment/actions.ts  # MODIFY — validate OnboardingSubmission + sniff photo/signature + rate-limit onboarding
  account/actions.ts      # MODIFY — rate-limit requestPasswordReset
auth.ts                   # MODIFY — rate-limit login authorize()
messages/en.json, messages/zh-CN.json  # MODIFY — new error keys (parity)
test: colocated *.test.ts for schemas, validate, rate-limit, file-type; action-level tests where noted.
```

---

## Task 1: Validation helper + centralized schemas (pure, unit-tested)

**Files:** Create `lib/validate.ts`, `lib/schemas.ts`; Test `lib/schemas.test.ts`

**Interfaces:**
- Produces: `validate<T>(schema: ZodType<T>, input: unknown): { ok:true; data:T } | { ok:false }` (never throws; on failure logs `console.warn` with the flattened error, returns `{ok:false}` so callers map to an i18n message).
- Produces schemas (with `z.infer` types exported): `saleSchema`, `newAssociateSchema`, `productSchema`, `comCodeSchema`, `onboardingSchema`. Each mirrors the existing input type's fields with bounds. The implementer MUST open each existing input type (`SubmitSaleInput` in `server/sales/actions.ts`, `NewAssociateInput` in `server/associates/actions.ts`, `ProductInput` in `server/products/actions.ts`, `OnboardingSubmission` in `server/recruitment/actions.ts`) and cover **every field** — the schemas below are the confirmed core; extend to match.

- [ ] **Step 1: Failing schema test**

```ts
// lib/schemas.test.ts
import { describe, it, expect } from "vitest";
import { saleSchema, comCodeSchema, onboardingSchema } from "./schemas";
import { validate } from "./validate";

describe("saleSchema", () => {
  it("rejects empty clientName and empty lines", () => {
    expect(saleSchema.safeParse({ clientName: "", lines: [] }).success).toBe(false);
  });
  it("accepts a valid sale and caps clientName length", () => {
    const ok = saleSchema.safeParse({ clientName: "Acme", lines: [{ productId: "p1", comCodeIds: ["c1"], amount: "100" }] });
    expect(ok.success).toBe(true);
    expect(saleSchema.safeParse({ clientName: "x".repeat(300), lines: [{ productId: "p1", comCodeIds: [], amount: "1" }] }).success).toBe(false);
  });
});
describe("comCodeSchema", () => {
  it("coerces valueType enum + rejects unknown", () => {
    expect(comCodeSchema.safeParse({ comCode: "A", label: "L", valueType: "Percentage", value: "10" }).success).toBe(true);
    expect(comCodeSchema.safeParse({ comCode: "A", label: "L", valueType: "Nope", value: "10" }).success).toBe(false);
  });
});
describe("validate()", () => {
  it("returns {ok:false} without throwing on bad input", () => {
    expect(validate(onboardingSchema, { junk: true })).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`pnpm vitest run lib/schemas.test.ts`).

- [ ] **Step 3: Implement `lib/validate.ts`**

```ts
import type { ZodType } from "zod";
export function validate<T>(schema: ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false } {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  console.warn("[validate] input rejected:", JSON.stringify(r.error.flatten().fieldErrors));
  return { ok: false };
}
```

- [ ] **Step 4: Implement `lib/schemas.ts`** (core confirmed fields; extend to full input types)

```ts
import { z } from "zod";
const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "money").max(20);
const id = z.string().trim().min(1).max(64);
const name = z.string().trim().min(1).max(200);

export const saleSchema = z.object({
  clientName: name,
  clientContact: z.string().trim().max(200).optional(),
  lines: z.array(z.object({
    productId: id,
    comCodeIds: z.array(id).max(50),
    amount: money,
  })).min(1).max(100),
});
export type SaleInput = z.infer<typeof saleSchema>;

export const comCodeSchema = z.object({
  comCode: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  valueType: z.enum(["Percentage", "Absolute"]),
  value: money,
});
export const productSchema = z.object({
  name: name,
  entity: id,
  retailPrice: money,
  commissionType: z.enum(["Percentage", "Fixed"]),
  // extend: cover every ProductInput field (rates, active, etc.)
}).passthrough();
export const newAssociateSchema = z.object({
  name: name,
  email: z.string().trim().email().max(200),
  designation: z.string().trim().max(60),
  // extend: cover every NewAssociateInput field (nric/bank are encrypted downstream — validate shape/length only)
}).passthrough();
export const onboardingSchema = z.object({
  fullName: name,
  email: z.string().trim().email().max(200).optional(),
  // extend: cover every OnboardingSubmission field; photo/signature handled by file-type task, not here
}).passthrough();
```
Note: `.passthrough()` is a deliberate temporary seam so unlisted fields don't break during wiring; the implementer MUST replace each `.passthrough()` with the full explicit field set once every field of the corresponding input type is covered, and remove the comment. Report as DONE_WITH_CONCERNS if any input type has a field you cannot confidently bound.

- [ ] **Step 5: Run — expect PASS.** Add `"invalidInput"` to `messages/en.json` + `messages/zh-CN.json` under `errors` (EN: "Invalid input.", ZH: "输入无效。").

- [ ] **Step 6: Commit** — `feat(security): centralized zod input schemas + validate() helper`.

---

## Task 2: Wire validation into sale + associate + product actions

**Files:** Modify `server/sales/actions.ts`, `server/associates/actions.ts`, `server/products/actions.ts`; Test `server/sales/validation.test.ts`

**Interfaces:** Consumes `validate`, `saleSchema`, `newAssociateSchema`, `productSchema`, `comCodeSchema` (Task 1).

- [ ] **Step 1: Failing test — submitSale rejects malformed before any DB call**

```ts
// server/sales/validation.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: new Proxy({}, { get() { throw new Error("DB must not be touched on invalid input"); } }) }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { associateId: "a1" } }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
import { submitSale } from "./actions";
describe("submitSale validation", () => {
  it("returns invalidInput and never touches the DB for malformed input", async () => {
    const r = await submitSale({ clientName: "", lines: [] } as any);
    expect(r).toEqual({ ok: false, error: "invalidInput" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (currently returns a different key / touches DB).

- [ ] **Step 3: Implement** — at the TOP of `submitSale` (after `getTranslations`, before `auth()`/DB), add:

```ts
import { validate } from "@/lib/validate";
import { saleSchema } from "@/lib/schemas";
// ...
const v = validate(saleSchema, input);
if (!v.ok) return { ok: false, error: t("invalidInput") };
const input2 = v.data; // use validated data downstream
```
Do the same at the top of `createAssociate` (`newAssociateSchema`), `createProduct`/`changeRates` (`productSchema`), and `addComCode` (`comCodeSchema`) — validate first, return `t("invalidInput")` on failure, keep the existing `requireAdmin()` check after. Use the validated `.data` downstream.

- [ ] **Step 4: Run — expect PASS**, plus full suite (`pnpm vitest run` + `pnpm tsc --noEmit`).

- [ ] **Step 5: Commit** — `feat(security): zod-validate sale/associate/product actions before DB`.

---

## Task 3: Validate the PUBLIC submitOnboarding boundary

**Files:** Modify `server/recruitment/actions.ts`; Test `server/recruitment/onboarding-validation.test.ts`

**Interfaces:** Consumes `validate`, `onboardingSchema`.

- [ ] **Step 1: Failing test** — `submitOnboarding(token, malformed)` returns `{ok:false}` without creating rows (mock prisma to throw if touched, mock token lookup to succeed).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — in `submitOnboarding`, after the token/candidate lookup succeeds but BEFORE any write/`putObject`, `validate(onboardingSchema, submission)`; on failure return `{ ok:false, error: t("invalidInput") }`. (Photo/signature bytes are validated in Task 7, not here.)
- [ ] **Step 4: Run — PASS** + full suite. **Step 5: Commit** — `feat(security): validate public onboarding submission`.

---

## Task 4: Rate-limit model + migration + DB-backed service

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/<ts>_add_rate_limit_attempt/migration.sql`, `lib/rate-limit.ts`; Test `lib/rate-limit.test.ts`

**Interfaces:**
- Produces model `RateLimitAttempt` (`@@map("rate_limit_attempts")`): `id` (cuid), `identifier` String, `action` String, `windowStart` DateTime, `count` Int, `lockedUntil` DateTime?, `updatedAt`. Unique on `(identifier, action)`.
- Produces `lib/rate-limit.ts`:
  - `checkRateLimit(identifier: string, action: RateAction): Promise<{ allowed: boolean; retryAfterSec?: number }>` — reads the row; if `lockedUntil > now` → `{allowed:false, retryAfterSec}`; else `{allowed:true}`. On DB error: log + `{allowed:true}` (fail-open).
  - `recordFailure(identifier, action): Promise<void>` — upsert; if the window (`WINDOW_MS`) elapsed, reset count=1/windowStart=now; else count++. When `count >= LIMITS[action]`, set `lockedUntil = now + LOCKOUT_MS` and reset count.
  - `recordSuccess(identifier, action): Promise<void>` — delete/reset the row.
  - `type RateAction = "login" | "password_reset" | "onboard_submit" | "esign_submit"`. `LIMITS`: login 5, password_reset 5, onboard_submit 10, esign_submit 10. `WINDOW_MS=15*60_000`, `LOCKOUT_MS=15*60_000`.

- [ ] **Step 1: Schema + migration** — add the model; `pnpm prisma migrate dev --name add_rate_limit_attempt` (local dev DB). Verify migration.sql created.

- [ ] **Step 2: Failing test (integration, real dev DB)**

```ts
// lib/rate-limit.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { checkRateLimit, recordFailure, recordSuccess } from "./rate-limit";
const ID = "test:" + Date.now();
beforeEach(async () => { await prisma.rateLimitAttempt.deleteMany({ where: { identifier: ID } }); });
describe("rate-limit", () => {
  it("allows under the limit, locks at the limit, success resets", async () => {
    for (let i = 0; i < 5; i++) { expect((await checkRateLimit(ID, "login")).allowed).toBe(true); await recordFailure(ID, "login"); }
    const blocked = await checkRateLimit(ID, "login");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    await recordSuccess(ID, "login");
    expect((await checkRateLimit(ID, "login")).allowed).toBe(true);
  });
});
```

- [ ] **Step 3: Run — FAIL. Step 4: Implement `lib/rate-limit.ts`** per the interface (use `prisma.rateLimitAttempt.upsert`, compare timestamps; wrap reads in try/catch for fail-open; `Math.ceil((lockedUntil-now)/1000)` for retryAfterSec).

- [ ] **Step 5: Run — PASS** + full suite. **Step 6: Commit** — `feat(security): DB-backed rate-limit + lockout service`.

---

## Task 5: Enforce rate-limit on login + password-reset request

**Files:** Modify `auth.ts`, `server/account/actions.ts`; Test `server/account/rate-limit.test.ts`

**Interfaces:** Consumes `checkRateLimit`, `recordFailure`, `recordSuccess` (Task 4).

- [ ] **Step 1: Failing test** — `requestPasswordReset(email)` returns `{ok:false}` (or the neutral no-enumeration `{ok:true}` per existing behavior — MATCH the current contract) once `checkRateLimit` is locked; assert `recordFailure` is invoked per attempt. (Mock `lib/rate-limit`.)
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** —
  - `auth.ts` `authorize(raw)`: identifier = the submitted email (lowercased) or `"unknown"`. Before verifying the password: `if (!(await checkRateLimit(id, "login")).allowed) return null;`. On bad credentials: `await recordFailure(id, "login")`. On success: `await recordSuccess(id, "login")`.
  - `server/account/actions.ts` `requestPasswordReset(email)`: `checkRateLimit(email.toLowerCase(), "password_reset")`; if blocked, return the SAME neutral response the endpoint already returns (no user enumeration); `recordFailure` on each request; keep behavior otherwise identical.
- [ ] **Step 4: Run — PASS** + full suite. **Step 5: Commit** — `feat(security): rate-limit login + password-reset request`.

---

## Task 6: Enforce rate-limit on public onboarding + e-sign submit

**Files:** Modify `server/recruitment/actions.ts` (and the e-sign submit action if separate); Test `server/recruitment/onboarding-ratelimit.test.ts`

**Interfaces:** Consumes `checkRateLimit`, `recordFailure`.

- [ ] **Step 1: Failing test** — after `LIMITS.onboard_submit` failed/blocked attempts for a token, `submitOnboarding(token, ...)` returns a blocked error; identifier = the onboarding token (unguessable, so token-scoped throttling is safe + targeted).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — at the start of `submitOnboarding` (before validation): `if (!(await checkRateLimit(token, "onboard_submit")).allowed) return { ok:false, error: t("tooManyAttempts") }` (add `tooManyAttempts` key EN/ZH); `recordFailure(token, "onboard_submit")` on validation/processing failure. Apply the same to the e-sign submit path (`esign_submit`, keyed by its token). Add `tooManyAttempts` to both message files.
- [ ] **Step 4: Run — PASS** + full suite. **Step 5: Commit** — `feat(security): rate-limit public onboarding + e-sign submit`.

---

## Task 7: Magic-byte upload validation

**Files:** Create `lib/file-type.ts`, `lib/file-type.test.ts`; Modify `server/recruitment/actions.ts` (photo + signature), and any agreement-upload path.

**Interfaces:**
- Produces `sniffFileType(bytes: Uint8Array): "png" | "jpeg" | "pdf" | null` — checks leading magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, PDF `25 50 44 46` = `%PDF`).
- Produces `assertUpload(bytes: Uint8Array, allow: Array<"png"|"jpeg"|"pdf">): "png"|"jpeg"|"pdf"` — returns the sniffed type if in `allow`, else throws `Error("BAD_UPLOAD_TYPE")`.

- [ ] **Step 1: Failing test**

```ts
// lib/file-type.test.ts
import { describe, it, expect } from "vitest";
import { sniffFileType, assertUpload } from "./file-type";
const PNG = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const JPEG = new Uint8Array([0xff,0xd8,0xff,0xe0]);
const PDF = new Uint8Array([0x25,0x50,0x44,0x46,0x2d]);
describe("sniffFileType", () => {
  it("detects png/jpeg/pdf and rejects junk", () => {
    expect(sniffFileType(PNG)).toBe("png");
    expect(sniffFileType(JPEG)).toBe("jpeg");
    expect(sniffFileType(PDF)).toBe("pdf");
    expect(sniffFileType(new Uint8Array([1,2,3,4]))).toBe(null);
  });
  it("assertUpload throws when type not allowed", () => {
    expect(assertUpload(PNG, ["png","jpeg"])).toBe("png");
    expect(() => assertUpload(PDF, ["png","jpeg"])).toThrow("BAD_UPLOAD_TYPE");
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement `lib/file-type.ts`**

```ts
export function sniffFileType(b: Uint8Array): "png" | "jpeg" | "pdf" | null {
  if (b.length >= 4 && b[0]===0x89 && b[1]===0x50 && b[2]===0x4e && b[3]===0x47) return "png";
  if (b.length >= 3 && b[0]===0xff && b[1]===0xd8 && b[2]===0xff) return "jpeg";
  if (b.length >= 4 && b[0]===0x25 && b[1]===0x50 && b[2]===0x44 && b[3]===0x46) return "pdf";
  return null;
}
export function assertUpload(b: Uint8Array, allow: Array<"png"|"jpeg"|"pdf">): "png"|"jpeg"|"pdf" {
  const t = sniffFileType(b);
  if (!t || !allow.includes(t)) throw new Error("BAD_UPLOAD_TYPE");
  return t;
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Wire into `server/recruitment/actions.ts`** — where the photo is read (`const bytes = Buffer.from(await s.photo.arrayBuffer())`), replace the `imageExt(s.photo.type)` trust with:
```ts
import { assertUpload, sniffFileType } from "@/lib/file-type";
// photo:
const photoBytes = new Uint8Array(await s.photo.arrayBuffer());
let sniffed: "png" | "jpeg";
try { sniffed = assertUpload(photoBytes, ["png","jpeg"]) as "png"|"jpeg"; }
catch { return { ok:false, error: t("invalidFileType") }; }
const ext = sniffed === "jpeg" ? "jpg" : "png";
await putObject(photoFileKey, Buffer.from(photoBytes));
```
For the base64 signature PNG (`sigMatch`), decode then `assertUpload(bytes, ["png"])` before `putObject`. For any agreement/document upload path, `assertUpload(bytes, ["pdf"])`. Add `invalidFileType` to both message files. Keep the existing size caps.
- [ ] **Step 6: Run full suite + `pnpm tsc --noEmit` — PASS. Commit** — `feat(security): magic-byte upload validation (png/jpeg photos, pdf docs)`.

---

## Self-Review Notes (completed)

- **Spec §4.2 coverage:** input validation (T1–T3), rate-limit + lockout DB-backed on login/reset/onboard/e-sign (T4–T6), upload magic-byte (T7). Decrypt-audit + temp-password already shipped (Phase 1b/1c). All §4.2 items covered.
- **Type consistency:** `validate`/schemas (T1) consumed in T2/T3; `checkRateLimit`/`recordFailure`/`recordSuccess` + `RateAction` (T4) consumed in T5/T6; `sniffFileType`/`assertUpload` (T7). Consistent names/signatures across tasks.
- **Placeholders:** the `.passthrough()` seams in T1 are explicitly flagged as temporary with a mandatory removal step (cover every input-type field) — not an open-ended TODO; the implementer reconciles against the real input types (which they read) and reports DONE_WITH_CONCERNS if a field can't be bounded. Everything else has complete code + tests.
- **Acceptance criteria mapped:** AC#2 (validation) T1–T3; AC#3 (rate-limit/lockout) T4–T6; AC#5 (upload magic-byte) T7.
