# VirtualOffice — Phase 1: Production Hardening + Service-Layer Foundation

**Status:** Design approved (2026-07-10), pending spec review → implementation plan
**Author:** Samuel Fu + Claude
**Scope owner:** Enshrine VirtualOffice (Associate Management Portal), `~/Desktop/Project/enshrine HRms/`, `git@github.com:Mavrone81/VirtualOffice.git`

---

## 1. Context

VirtualOffice is a single-tenant CRM + HRMS "virtual office" for Enshrine (a Singapore funeral/memorial company) that runs a self-employed sales associate's whole lifecycle: recruit → onboard/e-sign → submit sales → auto-calculate multi-level commissions → invoice → pay out. It is **live** at https://vo.urbanwerkzsg.com (Docker on 165, GitHub Actions auto-deploy), Next.js 15.5 + React 19 + Prisma 6 + Auth.js v5 + Postgres, pnpm.

An assessment against the original build-contract docs (`HR System for COM service/docs/`, the PRD, and `08_Security_and_PDPA.md`) found the app is **demo-complete, not production-trustworthy**. The commission engine (`server/commission/engine.ts`) and the sales→payout pipeline are genuinely well-built on the happy path, and the app is roughly PRD-feature-complete (remaining features — payment gateway, AI marketing, vendor/logistics LMS — were deliberately deferred by the client). But a set of security/PDPA controls were **specified in detail and never implemented**, money-safety has holes, the promised test pyramid is nearly absent, and there are no operational safety nets.

### Program context (why "Phase 1")

The larger goal is to productize VirtualOffice into a SaaS, with **Enshrine as anchor customer #1**. That is a three-phase program:

- **Phase 1 (this spec):** Harden Enshrine to production-trust + extract the service/data-access layer that Phases 2–3 build on.
- **Phase 2:** Multi-tenancy (`tenantId` boundary, de-hardcode Enshrine's 3 legal entities into tenant config, tenant-scoped everything, tenant admin).
- **Phase 3:** Productize the engine (data-driven commission plan designer) + tenant self-serve onboarding.

Phases 2 and 3 each get their own spec → plan → build cycle. Phase 1 must come first: real payouts can't responsibly run on the current build, and both later phases sit on Phase 1's service layer.

## 2. Goal & non-goals

**Goal:** Make the Enshrine instance production-trustworthy enough to run real associate onboarding, real commissions, and real money movement — critical-path only — and introduce the single structural seam (a principal-scoped service/data-access layer) that later phases depend on. File storage and backups move to DigitalOcean Spaces.

**Definition of done:** the high-severity security/PDPA + money-safety gaps are closed; the load-bearing tests (IDOR scoping + full pipeline) pass; automated backups run with a tested restore; a non-technical admin never sees a raw crash screen. We do **not** chase 90% coverage or low-severity items this phase.

**Explicit non-goals (deferred):**
- Full 90% test pyramid + Playwright E2E.
- Retention / erasure / consent-version / purge jobs.
- Full observability / error-tracking stack (minimal structured logging only).
- Actual multi-tenancy (Phase 2) and the configurable commission engine + self-serve onboarding (Phase 3).
- The vendor/supplier/logistics dispatch module (separate future product).
- **Not code:** closing the commercial-params decision sheet (`Commission_Payout_Decision_Sheet.md`) with Enshrine — the actual commission %s, per-entity invoice prefixes, external "Shifu" retained cut, and GIRO file spec. This is a parallel **client action** that unblocks real payouts; the engine cannot be correctly configured without it.

## 3. Decisions taken (from brainstorm)

| Decision | Choice |
|---|---|
| Overall program | Do A+B+C as a phased program; Phase 1 = hardening + service-layer foundation |
| Phase 1 bar | Critical-path first (not full 90% pyramid) |
| Rate-limiting infra | DB-backed attempt counter (survives restart, multi-instance/SaaS-ready) — not in-memory, not a new Redis container |
| File storage + backups | DigitalOcean Spaces (S3-compatible) for uploads **and** DB backups; presigned URLs for downloads |
| Service layer | A `Principal`-scoped data-access module; scoping enforced in one place |
| Temp passwords | Per-user cryptographically-random temp password + `mustResetPassword` flag forcing reset on first login |

## 4. Work-streams

### 4.1 Service / data-access layer (structural spine; Phase-2 seam)

**Problem:** server actions call `prisma` directly and each re-implements `requireAdmin()` and downline-scoping inline (duplicated across `server/payouts`, `server/associates`, `server/products`, …). The IDOR defense (`downlineIds()` recursive CTE in `lib/rbac.ts`) is a convention that's easy to forget, and there is no single place a `tenantId` filter could later be enforced.

**Design:**
- Introduce a `Principal` value object resolved once per request from the session: `{ userId, role, associateId, downlineAssociateIds }` (downline closure computed via the existing CTE).
- Introduce a scoped data-access module (e.g. `server/db/` or `lib/repo/`) exposing intent-named functions that **take the `Principal` as a required argument** and apply scoping internally — so "you can only read/act within your downline (or all, if admin)" is enforced by construction, in one place.
- Refactor existing server actions to resolve the principal once and call through this module instead of touching `prisma` + re-checking roles inline. `requireAdmin()` / `requireRole()` live in this layer.
- This is where Phase 2's `tenantId` scope will later be added (single chokepoint), so shape the interface with that in mind (principal will gain `tenantId`).

**Boundary/testability:** the scoping logic becomes independently unit/integration-testable (see 4.6). Consumers can't bypass scoping without going around the module — which becomes a reviewable smell.

### 4.2 Security & PDPA controls

- **Decrypt auditing:** wrap `decryptPII` (`lib/crypto` / wherever `decryptPII` lives) in a helper that writes an `action="decrypt_pii"` audit row (actor, subject associate, field, timestamp) at **every** call site — currently: `app/admin/associates/[id]/page.tsx`, `app/portal/pfile/page.tsx` (and admin P-file view), `app/admin/recruitment/[id]/page.tsx`, `lib/pdf/statement.tsx`, `server/payouts/bankfile.ts`. Make the raw decrypt private so it can't be called without going through the auditing helper. Restores the §3/§10 PDPA control the docs promise.
- **Input validation (zod):** add `zod` schemas at every server-action and route-handler boundary, validated **before** any DB write. Priority order: `submitSale` (`server/sales/actions.ts`), associate + product creation, and the **public** `submitOnboarding` endpoint (`server/recruitment/actions.ts`). Include numeric bounds, string length caps, enum coercion. Centralize schemas so input contracts are explicit at runtime, not just erased TS types.
- **Rate-limiting + lockout (DB-backed):** a small attempt-counter table keyed by (identifier, action) with a sliding window; enforce on login, password-reset request, and the public `/onboard/[token]` submit + e-sign submit. Lock/throttle after N failures; auto-expire. Chosen DB-backed so it survives container restarts and is multi-instance-ready.
- **Kill the shared temp password:** `server/associates/actions.ts` currently sets `"Enshrine#2026"` for every provisioned associate. Replace with a per-user cryptographically-random temp password (relayed via the existing email/creds path), and add a `mustResetPassword` boolean on `User`. Middleware forces any authenticated user with `mustResetPassword=true` to the change-password screen before any other route renders; clearing it requires setting a new password. Applies to onboarding-approval provisioning and admin password-reset.
- **Upload validation:** replace trust in the browser-supplied `File.type` (`imageExt(s.photo.type)`) with **magic-byte sniffing** of the actual bytes (allow-list of PNG/JPEG for photos, PDF for agreements) plus the existing size caps. Reject on mismatch.

### 4.3 File storage → DigitalOcean Spaces + signed URLs

**Problem:** `lib/storage.ts` is local-FS only (`.uploads` volume); `app/api/files/[...key]` serves via a session + path-prefix check with `private, max-age=300` (browser-cacheable), not the promised short-TTL signed URLs; a single volume is also a backup liability.

**Design:**
- Swap `lib/storage.ts` to an S3-compatible client (AWS SDK v3 S3 client) pointed at a DO Spaces bucket + region endpoint. Keep the same public interface (`put`, `get`, `signedUrl`, delete) so call sites don't change shape.
- **Downloads** issue a short-TTL **presigned GET URL**, returned only after the existing RBAC ownership/namespace check passes. No file bytes stream through the app; no long-lived cache.
- **Key namespacing:** prefix keys with a tenant segment now (e.g. `enshrine/associates/<id>/…`) — harmless single-tenant, free Phase-2 seam.
- **Migration:** one-time move of existing `.uploads` content into Spaces under the new key scheme; verify counts; keep the local dir as a fallback until verified, then remove the volume mount from `docker-compose.prod.yml`.
- **Config:** `SPACES_*` env (endpoint, region, bucket, key, secret) in `.env` (gitignored) + `.env.example`. User provisions the bucket + keys (dependency, §7).

### 4.4 Money-safety guards

- **Paid-row lock / state machine:** `setPayoutStatus` (`server/payouts/actions.ts`) currently does no current-status check. Enforce transitions **Pending → Approved → Paid** with **Paid terminal** — a Paid row cannot revert or be re-processed. Reject illegal transitions with a clear error.
- **Numbering integrity:** replace `count()+1`-inside-a-transaction invoice/transaction numbering (`server/sales/actions.ts`) with **Postgres sequences** (per legal entity where numbering is per-entity). Removes the concurrency race under simultaneous verifications.
- **Re-auth before money leaves:** require password re-entry (fresh credential check) immediately before generating a bank file / bulk payout (`server/payouts/bankfile.ts` entry action). Also write an audit row for bank-file generation.

### 4.5 Operational safety

- **Automated backups:** scheduled `pg_dump` of the Postgres DB → DO Spaces, with a retention policy (e.g. daily keep-N). **Tested restore:** document and actually run a restore into a scratch DB to prove the backup is usable. (Uploads now live in Spaces, which is itself durable/off-host, so backups are DB-focused.) Implement as a cron job on 165 (flock-guarded, log to `/var/log/`) consistent with the other 165 auto-jobs, or a container sidecar — chosen at plan time.
- **Error UX:** add `error.tsx`, `loading.tsx`, and `not-found.tsx` at each route group (`app/admin`, `app/portal`, `app/(auth)`, `app/onboard`, and root). A server error shows a branded, friendly message + retry, never the raw Next.js crash screen. Error boundaries log via the logger below.
- **Email stops silently failing:** `lib/mail.ts` currently no-ops (console log) when SMTP is unset. Change so a send attempt with missing/broken SMTP logs at error level and surfaces an operator-visible signal; in prod, a failed invite/reset must not vanish silently.
- **Minimal structured logging:** a small logger wrapper (level, JSON-ish structured fields) used by error boundaries, the audit best-effort path, and mail failures. Not a full observability/error-tracking stack — that's deferred.

### 4.6 Tests (load-bearing only)

Current state: 2 test files / ~9 cases (`server/commission/engine.test.ts`, `lib/rbac.test.ts`), pure-function only; no integration/E2E/permission tests; the `downlineIds()` CTE and the whole submit→payout pipeline are **untested**.

Add:
- **IDOR / permission tests** on the downline-closure scoping via the new service layer: an out-of-scope actor gets 403 / empty scope for read and action paths (the untested code that is the entire access-control defense).
- **One full-pipeline integration test** against a Prisma test DB: submit → verify → invoice → installment schedule → monthly payout → bank-file, asserting the ledger reconciles (ties to the engine's canonical `$10k → 600/80/40/280` example).
- **PII-masking serializer test** (masked values never leak the raw NRIC/bank).
- Keep the existing engine + RBAC unit tests.
- **CI:** add an integration-test job (spins a Postgres test DB) to `.github/workflows/ci-cd.yml`. **No 90% coverage gate** this phase — assert the critical modules run green.

## 5. Architecture / data-flow notes

- New/changed persistence: `User.mustResetPassword` (bool), an attempt-counter table (rate-limit), Postgres sequences for numbering. All via Prisma migrations.
- The `Principal`-scoped data-access module becomes the single path from server actions → DB for scoped entities. Admin-only actions still declare `requireAdmin()` inside that layer.
- Storage interface unchanged in shape; implementation swapped to Spaces; download path returns presigned URLs.
- Backups + rate-limit counters + audit are operational concerns kept out of the request hot path where possible (audit and mail are best-effort/non-blocking; decrypt-audit is on the critical path by design — a decrypt that can't be audited should fail closed).

## 6. Acceptance criteria

1. Every `decryptPII` call produces a `decrypt_pii` audit row; raw decrypt is unreachable without the auditing helper.
2. `submitSale`, associate/product creation, and public onboarding reject malformed input via zod before any write.
3. Login / password-reset / public onboarding + e-sign are rate-limited and lock out after repeated failures (DB-backed, survives restart).
4. No shared/static provisioning password exists; new associates get a random temp password and are forced to reset on first login.
5. Uploads validated by magic bytes; wrong content type rejected.
6. Files stored in DO Spaces; downloads via short-TTL presigned URLs gated by the RBAC check; no public/long-cache leakage.
7. A Paid payout row cannot revert or be re-processed; illegal status transitions rejected; bank-file generation requires re-auth and is audited.
8. Invoice/transaction numbering uses Postgres sequences (no `count()+1` race).
9. Automated `pg_dump` → Spaces runs on schedule with retention, and a restore has been executed successfully at least once and documented.
10. Every route group has `error.tsx` / `loading.tsx` / `not-found.tsx`; no raw crash screen reachable by a normal error.
11. Email failures log loudly and signal the operator; no silent no-op in prod.
12. IDOR/permission tests and the full-pipeline integration test pass in CI.

## 7. Dependencies & risks

- **User action (blocking storage/backups):** create a DO Spaces bucket + access keys; provide `SPACES_*` values for prod `.env`. (DigitalOcean account already in use for the droplets.)
- **User action (parallel, unblocks real payouts, not code):** fill the `Commission_Payout_Decision_Sheet.md` with Enshrine's real commission %s, per-entity invoice prefixes, external "Shifu" retained cut, and confirm the GIRO bank-file format against the bank's spec.
- **Prod migration risk:** the `.uploads` → Spaces migration and the numbering-sequence change touch live data. Do on a maintenance window with a fresh backup first (which this phase also builds). 165 is RAM-tight (3.9 GB, ~30 containers) — `next build` needs the `/swapfile-vo` re-added before a prod rebuild.
- **Deploy path:** GitHub Actions → GHCR → 165 auto-deploy is live; changes ship through it. Migrations must run on deploy.
- **Scope discipline:** resist pulling Phase 2/3 items in; the service layer is shaped *for* multi-tenancy but does not implement it here.

## 8. Out of this spec (tracked for later)

- Phase 2 multi-tenancy spec.
- Phase 3 configurable-engine + self-onboarding spec.
- Vendor/logistics dispatch module.
- Full test pyramid, retention/purge, observability stack.
