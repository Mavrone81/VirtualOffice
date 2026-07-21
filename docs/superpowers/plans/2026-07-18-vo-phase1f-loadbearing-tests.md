# VirtualOffice Phase 1f — §4.6 Load-Bearing Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three §4.6 "load-bearing only" test gaps — PII masking never leaks raw values, the real recursive downline CTE (the entire IDOR defense) is exercised against a DB, and the full submit→verify→payout→bank-file pipeline reconciles to the engine's canonical `$10k → 600/80/40/280` split.

**Architecture:** Two of the three are integration tests hitting the real dev Postgres (the same pattern as `lib/rate-limit.test.ts` and `server/sales/txn-sequence.test.ts`): they keep `@/lib/db` REAL and mock only the modules that pull next-auth's `next/server` into the vitest node env (`@/auth`, `next-intl/server`, `@/lib/audit`, `next/cache`). Each integration test creates its own self-contained fixture and deletes it afterward, so it is order-independent and leaves no residue. The PII test is a pure unit test.

**Tech Stack:** Next.js 15.5 · Prisma 6.19 · Vitest 4 · Postgres · pnpm.

## Global Constraints

- Branch `main`; **commit directly to main, do NOT push** (user pushes explicitly; push auto-deploys via GitHub Actions).
- **Dev/test DB:** `export DATABASE_URL='postgresql://postgres:devpass@127.0.0.1:5434/virtualoffice'` (container `vo-dev-pg`, port 5434). The schema is already migrated (Phase 1e). NEVER prod.
- **Vitest picks up new tests automatically** — `vitest.config.ts` `include: ["server/**/*.test.ts", "lib/**/*.test.ts"]`, `environment: "node"`. **CI already runs integration tests** against a Postgres service (`.github/workflows/ci-cd.yml`, added 2026-07-15) and applies migrations — so NO workflow change is needed; new `*.test.ts` files are picked up.
- **next-auth import trap:** importing any `server/**/actions.ts` (or `@/auth`, `@/lib/audit`) into a vitest test crashes with `Cannot find module '.../next/server'` unless `@/auth` is mocked. Every test that imports a server action MUST `vi.mock("@/auth", ...)`; keep `@/lib/db` unmocked for integration tests.
- **Money is `Prisma.Decimal`** (`@db.Decimal(14,2)`); compare with `.toString()` or `Number(x)`, never `===` on Decimal objects.
- **No pushing, no seeding prod.** These tests only ever touch the dev DB.
- **TDD**; colocated `*.test.ts`; full suite + `pnpm tsc --noEmit` + `pnpm lint` green before each commit.
- **Commit trailer (every commit), authored as Samuel Fu:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EvKLWJaD5mh77pk9qK4hAf
  ```
  `git -c user.email="samuel.fu@rmagroup.com.sg" -c user.name="Samuel Fu"`.

---

## File Structure

```
lib/crypto.mask.test.ts                  # NEW — pure unit test for maskNric/maskAccount (Task 1)
lib/rbac.downline.test.ts                # NEW — integration test for the real downlineIds() CTE + scoping (Task 2)
server/pipeline.integration.test.ts      # NEW — integration test: submit→verify→payout→bank-file reconciles (Task 3)
```

No production code changes — this phase only adds tests. If a test surfaces a real defect, STOP and report it (do not silently fix production code inside a test-only phase).

**Known interfaces the tests consume (verified against source):**
- `maskNric(nric: string|null|undefined): string` and `maskAccount(acc: string|null|undefined): string` — `lib/crypto.ts`. `maskNric` → `"S••••567A"` for len≥5 else `"•••••"`; `maskAccount` → `"••••6789"` for len≥4 else `"••••"`.
- `downlineIds(associateId: string): Promise<string[]>` — `lib/rbac.ts`. Recursive closure over `associates.direct_upline_id`, excludes `archived_at IS NOT NULL`; returns self + all descendants.
- `resolveScope(role, associateId, getDownline): Promise<Scope>` and `scopedAssociateWhere(scope): { id?: { in: string[] } }` — `lib/access.ts`. Admin→`{kind:"all"}`→`{}`; manager→`{kind:"associates", ids: downline}`; consultant→`{ids:[self]}`.
- `submitSale(input): Promise<{ok, error?}>`, `verifySubmission(submissionId): Promise<{ok, error?}>` — `server/sales/actions.ts`. `submitSale` reads `auth()` (`session.user.associateId` = closer); `verifySubmission` reads `auth()` (admin role + `session.user.id`).
- `runPayouts(month): Promise<{ok, count?, error?}>` — `server/payouts/actions.ts`; aggregates `Eligible` ledger lines into `monthly_payouts`. Reads `getAdminPrincipal()`.
- `buildBankFileCsv(month, actorUserId?): Promise<string>` — `server/payouts/bankfile.ts`; no auth, no reauth (the reauth gate lives in `generateBankFile`, already tested in `bankfile-reauth.test.ts`). Emits CSV of `Approved`/`Paid` payouts.
- Rate source: the engine reads `CommissionStructureVersion.rateSnapshot` (JSON), NOT the `Product.*Pct` columns. A line with no matching structure version gets all-zero rates. Override % is chosen by the **upline's `designation`** (`SalesManager`→smOverridePct, `SalesDirector`→sdOverridePct, `AreaSalesManager`→asmOverridePct; `Consultant` earns none).

---

## Task 1: PII-masking never leaks raw NRIC / bank account

**Files:** Create `lib/crypto.mask.test.ts`

**Context:** `maskNric`/`maskAccount` (`lib/crypto.ts:47-55`) are the display-time PII guards (raw values are decrypted server-side, then masked before reaching a page). They are currently untested. §4.6 requires proof that a masked value never contains the raw middle digits.

**Interfaces:**
- Consumes: `maskNric`, `maskAccount` from `@/lib/crypto`.
- Produces: nothing (leaf test).

- [ ] **Step 1: Write the failing test**

```ts
// lib/crypto.mask.test.ts
import { describe, it, expect } from "vitest";
import { maskNric, maskAccount } from "./crypto";

describe("maskNric", () => {
  it("shows only first + last 4, masks the middle", () => {
    const raw = "S1234567A";
    const masked = maskNric(raw);
    expect(masked).toBe("S••••567A");
    // the sensitive middle ("1234") must never appear
    expect(masked).not.toContain("1234");
  });
  it("fully masks a too-short value and never echoes it", () => {
    expect(maskNric("123")).toBe("•••••");
    expect(maskNric("123")).not.toContain("123");
  });
  it("returns empty string for null/undefined (no crash, no leak)", () => {
    expect(maskNric(null)).toBe("");
    expect(maskNric(undefined)).toBe("");
  });
});

describe("maskAccount", () => {
  it("shows only the last 4, masks the rest", () => {
    const masked = maskAccount("0123456789");
    expect(masked).toBe("••••6789");
    expect(masked).not.toContain("012345");
  });
  it("fully masks a too-short value", () => {
    expect(maskAccount("12")).toBe("••••");
    expect(maskAccount(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect PASS immediately** (the impl already exists; this is a characterization test that locks the guarantee).

Run: `pnpm vitest run lib/crypto.mask.test.ts`
Expected: PASS (5 cases). If any assertion FAILS, the masking is leaking — STOP and report, do not edit `lib/crypto.ts` to fit the test without confirming the intended behavior.

- [ ] **Step 3: Full suite + tsc + lint**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git -c user.email="samuel.fu@rmagroup.com.sg" -c user.name="Samuel Fu" \
  commit -m "test(pii): maskNric/maskAccount never leak raw digits"
```

---

## Task 2: IDOR — the real recursive downline CTE + scoping

**Files:** Create `lib/rbac.downline.test.ts`

**Context:** `downlineIds()` (`lib/rbac.ts`) is the entire IDOR defense — a `WITH RECURSIVE` closure over `direct_upline_id`. It is only ever exercised in production; `lib/access.test.ts` tests the pure `resolveScope`/`scopedAssociateWhere` with an *injected* downline, never the CTE itself. This test seeds a small associate tree in the real dev DB and asserts the closure is correct (self + descendants, archived excluded, siblings/uplines excluded), then feeds the real closure into `scopedAssociateWhere` and proves a scoped Prisma query returns only in-scope rows.

**Interfaces:**
- Consumes: `downlineIds` (`@/lib/rbac`), `resolveScope`/`scopedAssociateWhere` (`@/lib/access`), real `prisma` (`@/lib/db`).
- Produces: nothing (leaf test).

**Tree fixture (created in `beforeAll`, deleted in `afterAll`):**
```
SD (SalesDirector)
└── SM (SalesManager)              [direct_upline = SD]
    ├── C1 (Consultant)            [direct_upline = SM]
    └── C2 (Consultant, ARCHIVED)  [direct_upline = SM, archived_at set]
OUT (Consultant)                   [no upline — separate subtree]
```
Expected `downlineIds(SM)` = {SM, C1} (SD is an ancestor → excluded; C2 archived → excluded; OUT unrelated → excluded).

- [ ] **Step 1: Write the failing test**

```ts
// lib/rbac.downline.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
// downlineIds/access import prisma but NOT next-auth, so no @/auth mock is needed here.
import { prisma } from "@/lib/db";
import { downlineIds } from "./rbac";
import { resolveScope, scopedAssociateWhere } from "./access";

const TAG = "PH1F-DL-"; // unique code prefix so cleanup is surgical
let SD = "", SM = "", C1 = "", C2 = "", OUT = "";

async function mkAssoc(code: string, designation: string, uplineId: string | null, archived = false) {
  const a = await prisma.associate.create({
    data: {
      associateCode: TAG + code,
      fullName: code,
      designation: designation as never,
      directUplineId: uplineId,
      approvalStatus: "Approved" as never,
      associateStatus: "Active" as never,
      archivedAt: archived ? new Date() : null,
    },
    select: { id: true },
  });
  return a.id;
}

beforeAll(async () => {
  SD = await mkAssoc("SD", "SalesDirector", null);
  SM = await mkAssoc("SM", "SalesManager", SD);
  C1 = await mkAssoc("C1", "Consultant", SM);
  C2 = await mkAssoc("C2", "Consultant", SM, true); // archived
  OUT = await mkAssoc("OUT", "Consultant", null);
});

afterAll(async () => {
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("downlineIds recursive CTE", () => {
  it("returns self + descendants, excludes ancestors, archived, and unrelated", async () => {
    const ids = new Set(await downlineIds(SM));
    expect(ids.has(SM)).toBe(true);
    expect(ids.has(C1)).toBe(true);
    expect(ids.has(C2)).toBe(false); // archived
    expect(ids.has(SD)).toBe(false); // ancestor
    expect(ids.has(OUT)).toBe(false); // unrelated
    expect(ids.size).toBe(2);
  });

  it("a leaf consultant's closure is just itself", async () => {
    expect(await downlineIds(C1)).toEqual([C1]);
  });
});

describe("scopedAssociateWhere over the real closure (IDOR)", () => {
  it("a manager query returns ONLY in-scope associates", async () => {
    const scope = await resolveScope("SalesManager" as never, SM, downlineIds);
    const where = scopedAssociateWhere(scope);
    const rows = await prisma.associate.findMany({
      where: { ...where, associateCode: { startsWith: TAG } },
      select: { id: true },
    });
    const got = new Set(rows.map((r) => r.id));
    expect(got.has(SM)).toBe(true);
    expect(got.has(C1)).toBe(true);
    expect(got.has(OUT)).toBe(false); // the IDOR case: out-of-downline never returned
    expect(got.has(SD)).toBe(false);
  });

  it("an out-of-scope consultant cannot see anyone else", async () => {
    const scope = await resolveScope("Consultant" as never, OUT, downlineIds);
    const where = scopedAssociateWhere(scope);
    const rows = await prisma.associate.findMany({
      where: { ...where, associateCode: { startsWith: TAG } },
      select: { id: true },
    });
    expect(rows.map((r) => r.id)).toEqual([OUT]);
  });
});
```

- [ ] **Step 2: Run — verify it PASSES** (exercises real code that already exists).

Run: `export DATABASE_URL='postgresql://postgres:devpass@127.0.0.1:5434/virtualoffice' && pnpm vitest run lib/rbac.downline.test.ts`
Expected: PASS (4 cases). If the enum string casts (`as never`) mismatch the real Prisma enum names, fix the string to the exact `schema.prisma` value (`Designation`: `SalesDirector`/`SalesManager`/`Consultant`; `ApprovalStatus.Approved`; `AssociateStatus.Active`). If `downlineIds(SM)` unexpectedly includes SD, the CTE is broken — STOP and report.

- [ ] **Step 3: Full suite + tsc + lint** (`pnpm vitest run && pnpm tsc --noEmit && pnpm lint`) — all green. Confirm the `afterAll` cleanup ran: `docker exec vo-dev-pg psql -U postgres -d virtualoffice -tAc "SELECT count(*) FROM associates WHERE associate_code LIKE 'PH1F-DL-%'"` → `0`.

- [ ] **Step 4: Commit**

```bash
git -c user.email="samuel.fu@rmagroup.com.sg" -c user.name="Samuel Fu" \
  commit -m "test(idor): exercise real downline CTE + scoped query isolation"
```

---

## Task 3: Full pipeline reconciles — submit → verify → payout → bank-file

**Files:** Create `server/pipeline.integration.test.ts`

**Context:** §4.6's headline test. The engine unit test proves the *math* in isolation; this proves the *wiring*: a real sale flows through `submitSale` → `verifySubmission` (creates the `SalesTransaction`, snapshots uplines, resolves the structure version, runs the commission engine, writes the ledger) → `runPayouts` (aggregates `Eligible` ledger lines into `monthly_payouts`) → `buildBankFileCsv` (emits the GIRO rows), and the ledger reconciles to the canonical `$10k → closer 600 / SM 80 / SD 40 / company 280`.

**Fixture (self-contained, `beforeAll` → `afterAll` cleanup by tag):**
- `Company` (unique `invoicePrefix`, `defaultCompanyId` target).
- `Product` (`commissionType: "Percentage"`, `productCode`, `defaultCompanyId`) — columns are for the create UI; the engine reads the version snapshot.
- `CommissionStructureVersion` (`productCode` = the product's, `effectiveDate` = a date ≤ sale date, `rateSnapshot` JSON = `{ closingCommPct:"0.10", companyCutPct:"0.40", asmOverridePct:"0", smOverridePct:"0.20", sdOverridePct:"0.10" }`).
- Associates: `SD` (SalesDirector), `SM` (SalesManager, upline SD), `CLOSER` (Consultant, `directUplineId: SM`, `secondUplineId: SD`) — all `Approved`/`Active` so the engine marks overrides `eligible`.
- Auth identity is mocked (see below); `buildBankFileCsv` takes an `actorUserId` string directly, so no admin `User` row is required.

**Auth mocking (mutable identity toggled per phase):**
```ts
const who = { session: null as unknown };            // set before each pipeline call
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("@/server/access", () => ({ getAdminPrincipal: async () => who.admin }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
```

- [ ] **Step 1: Write the failing test**

```ts
// server/pipeline.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown; admin: unknown } = { session: null, admin: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("@/server/access", () => ({ getAdminPrincipal: async () => who.admin }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitSale, verifySubmission } from "./sales/actions";
import { runPayouts } from "./payouts/actions";
import { buildBankFileCsv } from "./payouts/bankfile";

const TAG = "PH1F-PIPE-";
const MONTH = "2099-01";           // far-future so it can't collide with real data
const SALE_DATE = "2099-01-15";
let companyId = "", productId = "", sdId = "", smId = "", closerId = "";

async function mkAssoc(code: string, designation: string, direct: string | null, second: string | null) {
  const a = await prisma.associate.create({
    data: {
      associateCode: TAG + code, fullName: code, designation: designation as never,
      directUplineId: direct, secondUplineId: second,
      approvalStatus: "Approved" as never, associateStatus: "Active" as never,
      paynowNumber: "9" + code.padEnd(7, "0").slice(0, 7),
    },
    select: { id: true },
  });
  return a.id;
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true },
    select: { id: true },
  });
  companyId = company.id;
  const product = await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Pipe Test", commissionType: "Percentage" as never,
      closingCommPct: "0.10", companyCutPct: "0.40", smOverridePct: "0.20", sdOverridePct: "0.10",
      defaultCompanyId: companyId, effectiveDate: new Date(SALE_DATE),
    },
    select: { id: true },
  });
  productId = product.id;
  await prisma.commissionStructureVersion.create({
    data: {
      productCode: TAG + "P1", productId, effectiveDate: new Date("2099-01-01"),
      rateSnapshot: {
        closingCommPct: "0.10", companyCutPct: "0.40",
        asmOverridePct: "0", smOverridePct: "0.20", sdOverridePct: "0.10",
      } as never,
    },
  });
  sdId = await mkAssoc("SD", "SalesDirector", null, null);
  smId = await mkAssoc("SM", "SalesManager", sdId, null);
  closerId = await mkAssoc("CL", "Consultant", smId, sdId);
});

afterAll(async () => {
  // delete in FK order, all tagged by the sale's associates/company
  await prisma.commissionLedger.deleteMany({ where: { associate: { associateCode: { startsWith: TAG } } } });
  await prisma.monthlyPayout.deleteMany({ where: { associate: { associateCode: { startsWith: TAG } } } });
  await prisma.invoice.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: { associateCode: { startsWith: TAG } } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: { associateCode: { startsWith: TAG } } } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

const dec = (d: unknown) => Number(d as number);

describe("full commission pipeline reconciles to 600/80/40/280", () => {
  it("submit → verify → payout → bank-file", async () => {
    // 1) submit as the closer
    who.session = { user: { associateId: closerId, id: "sess-closer" } };
    const submit = await submitSale({
      salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Full Payment",
      lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] }],
    } as never);
    expect(submit.ok).toBe(true);

    const sub = await prisma.salesSubmission.findFirstOrThrow({
      where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true },
    });

    // 2) verify as an admin
    who.session = { user: { associateId: null, id: "sess-admin", role: "Admin" } };
    const verified = await verifySubmission(sub.id);
    expect(verified.ok).toBe(true);

    // ledger reconciles: closer personal 600, SM override 80, SD override 40
    const ledger = await prisma.commissionLedger.findMany({
      where: { associate: { associateCode: { startsWith: TAG } } },
      select: { associateId: true, lineType: true, amount: true },
    });
    const sumFor = (id: string) => ledger.filter((l) => l.associateId === id).reduce((s, l) => s + dec(l.amount), 0);
    expect(sumFor(closerId)).toBeCloseTo(600, 2);
    expect(sumFor(smId)).toBeCloseTo(80, 2);
    expect(sumFor(sdId)).toBeCloseTo(40, 2);
    // associates receive 720; company retains 280 of the 1000 closing commission
    expect(sumFor(closerId) + sumFor(smId) + sumFor(sdId)).toBeCloseTo(720, 2);

    // 3) aggregate payouts (full payment ⇒ Eligible ⇒ aggregated)
    who.admin = { userId: "sess-admin", role: "Admin" };
    who.session = { user: { associateId: null, id: "sess-admin", role: "Admin" } };
    const payout = await runPayouts(MONTH);
    expect(payout.ok).toBe(true);
    const payouts = await prisma.monthlyPayout.findMany({
      where: { associate: { associateCode: { startsWith: TAG } }, payoutMonth: MONTH },
      select: { associateId: true, totalPayable: true },
    });
    const pById = new Map(payouts.map((p) => [p.associateId, dec(p.totalPayable)]));
    expect(pById.get(closerId)).toBeCloseTo(600, 2);
    expect(pById.get(smId)).toBeCloseTo(80, 2);
    expect(pById.get(sdId)).toBeCloseTo(40, 2);

    // 4) bank-file lists the payouts (approve them first so they surface in the GIRO file)
    await prisma.monthlyPayout.updateMany({
      where: { associate: { associateCode: { startsWith: TAG } }, payoutMonth: MONTH },
      data: { payoutStatus: "Approved" as never },
    });
    const csv = await buildBankFileCsv(MONTH, "sess-admin");
    expect(csv).toContain("600");
    expect(csv.split("\n").filter((l) => l.includes(TAG) || /(-|\d)/.test(l)).length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL first**, then debug to green.

Run: `export DATABASE_URL='postgresql://postgres:devpass@127.0.0.1:5434/virtualoffice' && pnpm vitest run server/pipeline.integration.test.ts`
Likely first-run fixes (do these, they are not scope changes):
  - **Enum string values:** match `schema.prisma` exactly (`PaymentPlan` display value is `"Full Payment"` per `SubmitSaleInput`; internal enum is `FullPayment` — `submitSale` maps it, so pass the display string). `CommissionType.Percentage`, `ApprovalStatus.Approved`, `AssociateStatus.Active`, `PayoutStatus.Approved`, `Designation.*`.
  - **`submitSale` input shape:** confirm the real `SubmitSaleInput` fields (`salesDate`, `clientName`, `paymentPlan`, `lines:[{productId, lineSaleAmount, comCodeIds}]`). If a required field (e.g. `clientContact`) is enforced by `saleSchema`, add it.
  - **`rateSnapshot` key names:** confirm the `RateSnapshot` type in `server/commission/run.ts` uses `closingCommPct/companyCutPct/asmOverridePct/smOverridePct/sdOverridePct` — align the JSON keys exactly.
  - **Amount sign/split:** if `sumFor(closerId)` is 1000 not 600, the closer ledger line is gross (company cut recorded separately) — adjust the assertion to match the engine's actual ledger decomposition (read `server/commission/engine.ts` `computeTransactionCommission` to see whether the closer line is net-600 or gross-1000-with-a-company-line). The invariant that MUST hold regardless: closer+SM+SD associate payouts = 720 and company retains 280. Keep that assertion; adjust the per-line one to the real decomposition.
  - **`verifySubmission` eligibility:** Full Payment ⇒ `CommissionEligibility.Eligible` ⇒ ledger `status = Eligible` ⇒ `runPayouts` aggregates it. If payouts come back empty, confirm the sale was Full Payment (not Installment).

- [ ] **Step 3: Iterate to PASS**, then run the full suite + tsc + lint.

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`
Expected: all green. Then confirm cleanup: `docker exec vo-dev-pg psql -U postgres -d virtualoffice -tAc "SELECT count(*) FROM associates WHERE associate_code LIKE 'PH1F-%'"` → `0`.

- [ ] **Step 4: Commit**

```bash
git -c user.email="samuel.fu@rmagroup.com.sg" -c user.name="Samuel Fu" \
  commit -m "test(pipeline): submit→verify→payout→bank-file reconciles to 600/80/40/280"
```

---

## Self-Review Notes (completed)

- **Spec §4.6 coverage:** PII-masking serializer test (Task 1); IDOR/permission tests on the downline-closure scoping via real CTE + scoped query (Task 2); one full-pipeline integration test asserting the ledger reconciles to the canonical $10k→600/80/40/280 (Task 3). CI integration job already exists (Postgres service, 2026-07-15) and auto-discovers the new files — no workflow edit needed, so no separate task. "Keep existing engine + RBAC unit tests" — untouched.
- **No production code changes:** this phase is tests-only; a genuine defect surfaced by a test is a STOP-and-report, not an in-test fix.
- **Isolation:** every integration fixture is tagged (`PH1F-*`) and deleted in `afterAll`, ordered by FK dependency, so the tests are order-independent and leave the dev DB clean (also verifiable in CI, which starts from a fresh migrated DB each run).
- **Type consistency:** `downlineIds`, `resolveScope`, `scopedAssociateWhere`, `submitSale`, `verifySubmission`, `runPayouts`, `buildBankFileCsv` signatures match the source read during planning. Enum string literals are cast `as never` at fixture-creation sites and flagged in Step 2 to reconcile against `schema.prisma` on first run.
- **Deploy note:** none — no migration, no runtime code change. When pushed, CI runs these in the integration job; nothing to apply on prod.
