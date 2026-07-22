# Quotation Approval Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a sale submission into a two-gate flow — team Director approves the split, then a Business Admin approves the rep's right to generate a client-facing **Quotation** — with freeform document uploads, a signed-docs docket, and commission that only becomes payable at payment.

**Architecture:** Reuse the existing submit→approve→pay pipeline. The "split-approved" state stays captured by `sdApprovedAt` + the 3-day lazy rule (no new stored status). Rename the terminal status `Verified → QuotationApproved` (one-line Postgres `RENAME VALUE`). The old `verifySubmission` becomes `approveQuotation` (creates the transaction + ledger **Pending** + invoice **Outstanding**, not Paid). Existing `markInvoicePaid`/`recomputeEligibility` already flip commission Eligible at payment — untouched. Split-approval **visibility/permission** moves from upline to **team director**; the lazy gate helpers stay.

**Tech Stack:** Next.js 15.5 / React 19 / Tailwind v4 / Prisma 6.19 + Postgres / Auth.js v5 / next-intl / @react-pdf/renderer / pnpm9 / vitest.

## Global Constraints

- **This is PROD (vo.urbanwerkzsg.com on 165).** Every schema migration is applied **migrate-deploy-only, never seed**; back up (pg_dump) before the migration; deploy via GitHub Actions (build image + SSH), which does **not** run migrations — apply on 165 off auto-mode after deploy.
- **i18n parity is mandatory:** every new UI string added to BOTH `messages/en.json` and `messages/zh-CN.json` (parity currently 930/930; a mismatch is a build/quality failure).
- **Uploads** go through `lib/storage.ts` `putObject` with magic-byte sniffing (`lib/file-type.ts` `assertUpload`), accepting `["pdf","png","jpeg"]`. 15 MB cap per file. Server Action body limit is 10 MB (`next.config.ts`) — uploads of larger files must warn, not 500.
- **Reuse, don't rewrite:** the commission engine (`server/commission/*`), eligibility (`recomputeEligibility`), PDF patterns (`lib/pdf/*`), audit (`lib/audit.ts logAudit`), and access helpers stay as-is.
- **Verify each slice green** before the next: `pnpm exec tsc --noEmit`, `pnpm exec vitest run`, `pnpm build`, `pnpm exec next lint`; dev DB via `docker compose up -d db` (host :10501, `DATABASE_URL` in `.env`).
- **Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + the Claude-Session line.

## File Structure

- `prisma/schema.prisma` — rename enum value; add `SubmissionDocument` + `SubmissionDocKind`.
- `prisma/migrations/<ts>_quotation_workflow/migration.sql` — `RENAME VALUE` + `CREATE TABLE`/enum.
- `server/teams/actions.ts` — team-add sets `directUplineId = director`.
- `lib/approval.ts` — add `teamDirectsCloser` visibility helper (team-based); keep `pendingSdApproval`.
- `app/portal/approvals/page.tsx` + `approve-split-button.tsx` — team-routed query, full sale detail.
- `server/sales/actions.ts` — `submitSale` accepts documents; rename `verifySubmission → approveQuotation` (invoice Outstanding, ledger Pending, status QuotationApproved) + `rejectSubmission`.
- `server/documents/submission-docs.ts` (new) — `addSubmissionDocuments`, `addSignedDocket`, `listSubmissionDocuments`.
- `app/admin/quotations/` (new) — list + `[id]` detail + approve/reject buttons.
- `app/admin/sales/verify/` — redirect to `/admin/quotations`.
- `lib/pdf/quotation.tsx` (new) — rep-facing Quotation PDF.
- `app/portal/quotations/` (rename of the "My Invoices" surface) — Quotation PDF + docket upload + invoice-when-paid.
- `lib/nav.ts` — "My Invoices"→"My Quotations"; Split Approvals visible to team directors; add admin "Quotations".
- `messages/en.json`, `messages/zh-CN.json` — all new strings, in parity.

---

### Task 1: Schema — rename status, add document model

**Files:**
- Modify: `prisma/schema.prisma` (enum `SubmissionStatus`; new `model SubmissionDocument`, `enum SubmissionDocKind`)
- Create: `prisma/migrations/<ts>_quotation_workflow/migration.sql`
- Modify: every `SubmissionStatus.Verified` reference (grep first) → `SubmissionStatus.QuotationApproved`
- Test: `lib/status-label.test.ts` (label mapping) if a label map exists; else a compile check only.

**Interfaces:**
- Produces: `SubmissionStatus { Submitted, QuotationApproved, Rejected }`; `SubmissionDocKind { Supporting, Signed }`; `SubmissionDocument { id, submissionId, kind, fileKey, fileName, uploadedById?, createdAt }` with relation `SalesSubmission.documents`.

- [ ] **Step 1: Edit schema** — in `enum SubmissionStatus` rename `Verified` to `QuotationApproved`. Add:
```prisma
enum SubmissionDocKind {
  Supporting
  Signed
}

model SubmissionDocument {
  id           String            @id @default(uuid()) @db.Uuid
  submissionId String            @map("submission_id") @db.Uuid
  submission   SalesSubmission   @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  kind         SubmissionDocKind
  fileKey      String            @map("file_key")
  fileName     String            @map("file_name")
  uploadedById String?           @map("uploaded_by") @db.Uuid
  createdAt    DateTime          @default(now()) @map("created_at")

  @@index([submissionId])
  @@map("submission_documents")
}
```
Add `documents SubmissionDocument[]` to `model SalesSubmission`.

- [ ] **Step 2: Write the migration SQL by hand** (do NOT `migrate dev` against prod data shapes — author it): `prisma/migrations/<ts>_quotation_workflow/migration.sql`:
```sql
ALTER TYPE "SubmissionStatus" RENAME VALUE 'Verified' TO 'QuotationApproved';
CREATE TYPE "SubmissionDocKind" AS ENUM ('Supporting', 'Signed');
CREATE TABLE "submission_documents" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "kind" "SubmissionDocKind" NOT NULL,
  "file_key" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "uploaded_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "submission_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "submission_documents_submission_id_idx" ON "submission_documents"("submission_id");
ALTER TABLE "submission_documents" ADD CONSTRAINT "submission_documents_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "sales_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Update all code refs** — `grep -rn "SubmissionStatus.Verified" server app lib` and replace each with `SubmissionStatus.QuotationApproved`. Regenerate client: `pnpm prisma generate`.

- [ ] **Step 4: Apply on dev DB + verify** — `docker compose up -d db`; `pnpm prisma migrate deploy`; `pnpm exec tsc --noEmit` → clean; `pnpm exec vitest run` → all green (existing tests referencing Verified must be updated to QuotationApproved).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(schema): rename Verified→QuotationApproved + SubmissionDocument"`.

---

### Task 2: Team membership sets the member's upline to the Director

**Files:**
- Modify: `server/teams/actions.ts` (the add-member action)
- Test: `server/teams/upline-sync.test.ts`

**Interfaces:**
- Consumes: existing add-member action signature in `server/teams/actions.ts`.
- Produces: after adding associate A to team T (director D), `A.directUplineId === D`.

- [ ] **Step 1: Read** `server/teams/actions.ts` to find the add-member action and the team's `directorId`.
- [ ] **Step 2: Write failing test** `server/teams/upline-sync.test.ts` (mock prisma like `server/associates/uplines.test.ts`): adding a member to a team whose `directorId='d1'` calls `associate.update` with `data: { directUplineId: 'd1' }`.
- [ ] **Step 3: Run → fails.**
- [ ] **Step 4: Implement** — in the add-member action, after creating the `TeamMember`, if the team has a `directorId`, `await prisma.associate.update({ where: { id: associateId }, data: { directUplineId: team.directorId } })`; `logAudit('associate.upline.team_synced', ...)`. Guard: skip if `associateId === directorId`.
- [ ] **Step 5: Run → passes; tsc clean.**
- [ ] **Step 6: Commit.**

---

### Task 3: Split-approval routed by team + full sale detail

**Files:**
- Modify: `app/portal/approvals/page.tsx` (query + detail)
- Modify: `server/sales/actions.ts` `approveSubmissionSplit` (permission: team director or admin)
- Modify: `lib/nav.ts` (Split Approvals visible to team directors, not only SalesDirector)
- Modify: `app/portal/layout.tsx` (badge count → team-routed)
- Create: `lib/approval-routing.ts` — `directsTeamOf(directorId, closerId)` pure resolver + test
- Test: `lib/approval-routing.test.ts`

**Interfaces:**
- Consumes: `Team`/`TeamMember` (`directorId`, members).
- Produces: `directsTeamOf(input: { directorId: string; closerTeamDirectorIds: string[] }): boolean`; portal approvals lists submissions whose closer is in a team the viewer directs.

- [ ] **Step 1: Write failing test** `lib/approval-routing.test.ts`: `directsTeamOf({ directorId:'d1', closerTeamDirectorIds:['d1','d2'] })===true`; `false` when absent.
- [ ] **Step 2: Implement** `lib/approval-routing.ts` (pure).
- [ ] **Step 3: Portal approvals query** — for a non-admin viewer, show `SubmissionStatus.Submitted`, `sdApprovedAt:null`, where `closingAssociate.teamMemberships.some(team.directorId === viewer.associateId)`. (Prisma: `closingAssociate: { is: { /* member of a team directed by viewer */ } }` — use a `team.findMany({ where:{ directorId: viewerId }})` → member ids → `closingAssociateId: { in: memberIds }`.) Admin still sees all pending. Render **full detail**: line items (product + amount) + split shares + client — expand the existing card.
- [ ] **Step 4: `approveSubmissionSplit` permission** — allow if `isFullAdmin` OR the viewer directs a team containing the closer. Keep setting `sdApprovedAt`.
- [ ] **Step 5: Nav + badge** — `DIRECTOR_ROLES` gate on Split Approvals augmented so any team director sees it; badge count uses the team-routed query.
- [ ] **Step 6: i18n** for any new labels (both locales).
- [ ] **Step 7: tsc + vitest + lint green; commit.**

---

### Task 4: Rep uploads supporting documents at submission

**Files:**
- Create: `server/documents/submission-docs.ts` — `addSubmissionDocuments(submissionId, files, uploaderId)`, `listSubmissionDocuments(submissionId)`
- Modify: `server/sales/actions.ts` `submitSale` — accept `documents?: File[]`, persist as `Supporting`
- Modify: `app/portal/sales/new/*` — optional multi-file input
- Test: `server/documents/submission-docs.test.ts`

**Interfaces:**
- Produces: `addSubmissionDocuments(submissionId: string, files: File[], kind: SubmissionDocKind, uploaderId: string|null): Promise<{ok:boolean;error?:string}>`; `listSubmissionDocuments(submissionId): Promise<{id,kind,fileName,fileKey}[]>`.

- [ ] **Step 1: Failing test** — `addSubmissionDocuments` sniffs each file (reject non pdf/png/jpeg), `putObject` under `submissions/<id>/<uuid>.<ext>`, creates a `SubmissionDocument` row per file; returns error on oversize (>15 MB).
- [ ] **Step 2: Implement** `submission-docs.ts` (mirror `uploadSignedInvoice` in `server/invoices/actions.ts` for the sniff/store pattern).
- [ ] **Step 3: Wire `submitSale`** — after creating the submission, if `documents?.length`, call `addSubmissionDocuments(sub.id, documents, "Supporting", session.user.id)`. Do not fail the sale if a doc is rejected — return a soft warning (per Global Constraints: warn, don't 500).
- [ ] **Step 4: Form** — add an optional `<input type="file" multiple>` to the submit form; pass files through the Server Action (FormData). Keep total under the 10 MB body limit; warn if exceeded.
- [ ] **Step 5: tsc + vitest + build green; commit.**

---

### Task 5: Admin "Quotations" tab — review + approve/reject

**Files:**
- Create: `app/admin/quotations/page.tsx` (list) + `app/admin/quotations/[id]/page.tsx` (detail) + `approve-reject-buttons.tsx`
- Modify: `server/sales/actions.ts` — rename `verifySubmission → approveQuotation`; add `rejectSubmission`
- Modify: `app/admin/sales/verify/page.tsx` → redirect to `/admin/quotations`
- Modify: `lib/nav.ts` (admin "Quotations" entry; retire "Sales · Verify" or point it at the new tab)
- Test: `server/sales/approve-quotation.test.ts` (extend `split.integration.test.ts` patterns)

**Interfaces:**
- Consumes: `pendingSdApproval` (`lib/approval.ts`), `runCommission`, `nextTransactionCode`.
- Produces: `approveQuotation(submissionId): Promise<{ok,error?}>` — gate `pendingSdApproval` must be satisfied; creates `SalesTransaction` + ledger (**PendingCollection**) + invoice(s) **Outstanding** (Full Payment) / installment plan (as today); sets status `QuotationApproved`; audits. `rejectSubmission(submissionId, reason?)` → status `Rejected`, audited.

- [ ] **Step 1: Rework the approve action** — copy `verifySubmission` to `approveQuotation`. Changes vs today: (a) require gate `if (pendingSdApproval(sub, closer)) return pendingSdApproval error`; (b) transaction `commissionEligibility: CommissionEligibility.PendingCollection` **always** (not Eligible-on-full); (c) `amountCollected: 0`; (d) the Full-Payment invoice `status: InvoiceStatus.Outstanding`, **no** `paidDate`; (e) set submission status `QuotationApproved`; keep the auto-approve audit stamping. Installment plan/schedule creation unchanged. Keep `runCommission(txId)` (ledger lines land Pending because eligibility is PendingCollection).
- [ ] **Step 2: Failing integration test** (dev DB) — submit → split-approve → `approveQuotation`: asserts a `SalesTransaction` exists, ledger rows `status=Pending`, invoice `status=Outstanding`, submission `status=QuotationApproved`. Then `markInvoicePaid` → ledger `Eligible`.
- [ ] **Step 3: Implement to green.**
- [ ] **Step 4: Admin list page** `/admin/quotations` — submissions `status=Submitted` AND `isSdApproved(sub).approved` (split-approved / 3-day), newest first; columns date/client/amount/closer/docs-count; row → detail.
- [ ] **Step 5: Detail page** `/admin/quotations/[id]` — full sale (line items, split shares, client info) + **document list** (view/download via `/api/files/[...key]`) + Approve / Reject buttons.
- [ ] **Step 6: Retire verify** — `app/admin/sales/verify/page.tsx` becomes `redirect('/admin/quotations')`; nav updated.
- [ ] **Step 7: i18n both locales; tsc + vitest + build + lint green; commit.**

---

### Task 6: Quotation PDF + rep "My Quotations" + docket

**Files:**
- Create: `lib/pdf/quotation.tsx` (rep-facing Quotation, mirror `lib/pdf/*` invoice template, titled "QUOTATION")
- Create: `app/portal/quotations/page.tsx` (rename of the My Invoices surface) + `[id]/pdf/route.ts` + `docket-upload.tsx`
- Modify: `lib/nav.ts` — "My Invoices" → "My Quotations"
- Modify: `server/documents/submission-docs.ts` — `addSignedDocket` (kind `Signed`, closer-or-admin gate via `canManageSignedInvoice`-style check)
- Test: `server/documents/docket.test.ts`

**Interfaces:**
- Consumes: `SalesTransaction`/`SalesSubmission` for the signed-in associate; `addSubmissionDocuments(..., "Signed", ...)`.
- Produces: `/portal/quotations/[id]/pdf` streams the Quotation PDF for a `QuotationApproved` sale owned by the viewer; docket upload persists `Signed` docs.

- [ ] **Step 1: Quotation PDF** — `lib/pdf/quotation.tsx` renders line items + amounts + client + associate, header "QUOTATION", no "Paid" markings. Route `/portal/quotations/[id]/pdf` (owner or admin only) returns it.
- [ ] **Step 2: Rep page** `/portal/quotations` — for the viewer's sales at `status=QuotationApproved`: show client/amount, **Download quotation** link, **docket upload** (multiple, `Signed`), and when a Paid invoice exists show the **Invoice** link too. Reuse the existing signed-upload component pattern.
- [ ] **Step 3: Failing test** — `addSignedDocket` rejects a non-owner non-admin; accepts the closing associate; stores `Signed` docs.
- [ ] **Step 4: Implement to green.**
- [ ] **Step 5: Nav rename** + i18n both locales.
- [ ] **Step 6: tsc + vitest + build + lint green; commit.**

---

### Task 7: End-to-end verification + prod rollout

**Files:** none (ops).

- [ ] **Step 1: Full local gate** — `pnpm exec tsc --noEmit`, `pnpm exec vitest run`, `pnpm build`, `pnpm exec next lint`, i18n parity check all clean.
- [ ] **Step 2: Push** to `main` (GitHub Actions builds + deploys).
- [ ] **Step 3: pg_dump backup on 165** before the migration: `docker exec virtualoffice-db pg_dump -U $POSTGRES_USER $POSTGRES_DB > /root/vo-pre-quotation-$(date).sql` (off auto-mode).
- [ ] **Step 4: Apply migration migrate-deploy-ONLY** on 165 (no seed): `docker compose -f docker-compose.prod.yml --profile tools run --rm --build migrate pnpm prisma migrate deploy` (override command to migrate-deploy only, mirror the 2026-07-18 procedure).
- [ ] **Step 5: Headless live smoke** — submit (as a rep) → director split-approve → admin approve in the Quotations tab → rep downloads the Quotation + uploads a signed doc → admin marks Paid → commission Eligible. Confirm `/login` 200 and no errors in `docker logs virtualoffice-app`.
- [ ] **Step 6: Update memory** ([[worklog]] + intelligence §9).

## Self-Review

- **Spec coverage:** §3 workflow → Tasks 2–6; §4.1 enum → Task 1 (rename, simpler than swap — documented); §4.2 docs → Tasks 1/4/6; §5.1 submit-docs → Task 4; §5.2 split-approval team routing + full detail → Task 3; §5.3 admin Quotations tab → Task 5; §5.4 rep quotations + docket → Task 6; §5.5 invoice/commission at pay → Task 5 (Outstanding+Pending) reusing existing mark-paid; §6 team↔upline → Task 2; §7 eligibility unchanged → Task 5 reuse; §8 rollout → Task 7. Covered.
- **Deviation from spec (intentional, lower prod risk):** no multi-value enum swap or stored `SplitApproved` — split-approved state stays `sdApprovedAt`+3-day; only `Verified→QuotationApproved` rename. Flag to owner in the execution summary.
- **Placeholders:** none — actions reference real existing functions (`pendingSdApproval`, `runCommission`, `recomputeEligibility`, `markInvoicePaid`, `putObject`, `assertUpload`).
- **Type consistency:** `approveQuotation`/`rejectSubmission`/`addSubmissionDocuments`/`addSignedDocket`/`directsTeamOf` names used consistently across tasks.
