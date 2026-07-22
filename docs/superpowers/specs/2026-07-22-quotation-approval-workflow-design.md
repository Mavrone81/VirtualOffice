# Quotation Approval Workflow — Design Spec

Date: 2026-07-22
Status: Approved (brainstorm decisions locked with the product owner)
Scope: VirtualOffice (Enshrine Management Portal), live on 165 at vo.urbanwerkzsg.com

## 1. Problem / context

Today a sale goes `Submitted → (Business-Admin Verify) → Verified`, and the
Verify step alone creates the `SalesTransaction`, the commission ledger, and an
"invoice" PDF. Consequences the product owner hit:

- A Sales Associate sees **nothing** after submitting — no rep-facing document
  until an admin verifies.
- The team **Director** they set up cannot approve: split-approval keys off the
  **upline chain**, not the **team**, so the director sees the sale under Team
  Sales but has nothing to approve.
- The generated document is mislabelled — it should be a **Quotation** (a
  pre-payment document the rep sends to the client to sign), not an invoice.
- Approvers act **blind** — the approve control doesn't show the full sale
  detail (line items + split).

## 2. Locked decisions (from brainstorm)

1. **Approval follows the TEAM.** The split-approver is the **Director of the
   closer's team**. Assigning an associate to a team also sets that associate's
   **direct upline = the team Director**, so commission overrides and approval
   stay in sync.
2. **Two sequential triggers after submission:** (1) split approval → team
   Director (auto-approves after 3 calendar days) → *then* (2) admin review.
3. **Admin review = a new "Quotations" tab** (admin-only): view the submission,
   check client details, review uploaded documents, then approve the rep's right
   to generate the quotation (or reject).
4. **Commission is only *confirmed* (Eligible/payable) at payment** — when the
   admin marks the sale **Paid** (Full Payment) or, for an installment plan,
   after the **3rd installment** is paid. Unchanged from today's eligibility
   rules; only the *creation point* of the ledger moves.
5. **Documents are freeform at both ends** — the rep may upload any number of
   supporting documents at submission (all optional), and any number of signed
   documents into the docket afterward. No hard "mandatory agreement" rule.
6. **Quotation now, invoice later.** Generate a **Quotation** for the rep at
   admin-approval (pre-payment, for client signature). Generate the real
   **Invoice** only when the sale is actually **Paid** / collected.

## 3. Workflow (end to end)

```
SA submits sale
  ├─ line items + split (Assoc 2/3) + client info      [exists]
  └─ upload supporting documents (0..n, optional)        [new]
        │
        ▼  status = Submitted
Trigger 1 — Split approval → team Director
  ├─ Director sees it in "Split Approvals" with FULL detail (line items + split + client)
  ├─ Director approves  ─or─  auto-approve after 3 days
        │
        ▼  status = SplitApproved   (now visible to admin)
Trigger 2 — Admin "Quotations" tab
  ├─ Admin reviews client details + uploaded documents
  ├─ Approve → create SalesTransaction + commission ledger (Pending)   ─or─  Reject
        │
        ▼  status = QuotationApproved
Rep — My Quotations
  ├─ view / download the Quotation PDF (rep-facing)
  ├─ send to client to sign
  └─ upload signed documents into the sale's docket (0..n)
        │
        ▼  (later) Admin marks Paid  /  3rd installment paid
              ├─ generate Invoice PDF (paid side)
              └─ commission flips Eligible   [existing recomputeEligibility]
```

## 4. Data model changes

### 4.1 `SubmissionStatus` enum
- Now: `Submitted, Verified, Rejected`.
- New: `Submitted, SplitApproved, QuotationApproved, Rejected`.
- Migration: safe Postgres enum-swap (add new type, backfill, swap column type,
  drop old). Existing prod `Verified` rows → **`QuotationApproved`** (they
  already have a `SalesTransaction`, so they are past the admin gate). Applied
  **migrate-deploy-only, no seed**.

### 4.2 New `SubmissionDocument` table
```
id            uuid pk
submissionId  uuid  -> SalesSubmission (cascade)
kind          enum SubmissionDocKind { Supporting, Signed }
fileKey       text            // object-store key (lib/storage.ts)
fileName      text
uploadedById  uuid? -> User
createdAt     timestamptz
```
- `Supporting` = uploaded at/around submission; `Signed` = uploaded into the
  docket after the quotation is generated. Both freeform, multiple.
- Files go through the existing `lib/storage.ts` object store with magic-byte
  sniffing (`lib/file-type.ts`) — accept PDF + PNG/JPEG (extend the sniffer if
  the owner wants DOCX later; out of scope now).

### 4.3 Existing entities
- `SalesSubmission` keeps `sdApprovedAt/ById` (split-approval stamp), gains the
  documents relation. No structural change to the split fields.
- `SalesTransaction`, `Invoice`, `CommissionLedger`, installment tables:
  unchanged shape; only the *timing* of Transaction/Invoice creation moves.

## 5. Surfaces

### 5.1 Submission — `/portal/sales/new`
Add an optional multi-file upload section (supporting documents). On submit,
persist `SubmissionDocument(kind=Supporting)` rows alongside the submission.

### 5.2 Split approval — `/portal/approvals` (Director)
- **Route by team:** show submissions whose closer is a member of a team this
  user **directs**, still `Submitted` and not yet split-approved. (Admin sees
  all pending, as today.)
- Show **full sale detail** (line items + amounts + split shares + client).
- Approve → `sdApprovedAt` set, status `Submitted → SplitApproved`; 3-day auto
  approval still applies and is **audited** (already shipped 2026-07-21).
- **Visibility:** the "Split Approvals" nav + page open to anyone who **directs a
  team** (not only the `SalesDirector` role) + Admin.

### 5.3 Admin Quotations tab — `/admin/quotations` (new, admin-only)
- Lists `SplitApproved` submissions (and, filterable, later states for
  traceability).
- Detail view: full sale + client + **uploaded documents** (view/download).
- **Approve** → create `SalesTransaction` + commission ledger (Pending
  eligibility), status `QuotationApproved`. **Reject** → `Rejected` (reason
  optional), audited.
- This replaces the old `/admin/sales/verify` semantics; the old verify route is
  retired/redirected to the new tab.

### 5.4 Rep quotations + docket — `/portal/quotations` (rename of "My Invoices")
- Nav "My Invoices" → **"My Quotations"**.
- Per sale that is `QuotationApproved`: **view/download the Quotation PDF**
  (`lib/pdf/quotation.tsx`, rep-facing, pre-payment), and an **upload control**
  for signed documents (`SubmissionDocument(kind=Signed)`, freeform).
- Once the sale is Paid and an Invoice exists, the **Invoice** link also appears
  on the same row (quotation-now / invoice-later on one surface).

### 5.5 Payment → Invoice + commission (existing admin payment controls)
- Move `Invoice` generation out of the approval step into the **mark-Paid**
  action (Full Payment) and keep installment handling. On mark-Paid: generate
  the Invoice PDF (paid side) + run `recomputeEligibility` (flips ledger
  Eligible). Installment: Invoice/eligibility on the 3rd installment as today.

## 6. Team ↔ upline sync
- Adding a `TeamMember` sets that associate's `directUplineId = team.directorId`
  (if the team has a director). Removing/moving does not auto-null (admin can
  fix via the upline editor shipped 2026-07-21).
- Split-approval routing uses the **team-director** relationship; commission
  overrides use the (now-synced) upline chain — Tier-1 → the Director.

## 7. Commission / eligibility (unchanged engine)
- Ledger created at `QuotationApproved` as **Pending**.
- `recomputeEligibility` (existing) flips it **Eligible** at Paid (Full) / 3rd
  installment. The positional override engine (direct = Tier-1, second = Tier-2)
  is reused untouched.

## 8. Rollout (this is PROD)
- Enum migration: **migrate-deploy-only**, additive + backfill, **never seed**;
  apply on 165 off auto-mode after the code deploys (documented gotcha: CI does
  not run migrations).
- Build in **independently-verifiable slices** (see the implementation plan),
  each green (tsc + vitest + build) and headlessly verified on the live path
  before the next.
- Reuse the existing commission/eligibility/PDF/storage/audit modules; do not
  rewrite them.
- Back up (pg_dump) before the enum migration; keep the old verify route
  reachable until the new tab is verified live.

## 9. Testing
- Unit: status-transition guards; team-based split-approval routing
  (`sdApproverId`/team resolver); team-add → upline sync; document-kind rules;
  eligibility timing (Pending at approve, Eligible at paid/3rd installment).
- Integration (dev DB): submit-with-docs → split-approve → admin-approve
  (transaction+ledger Pending, no invoice) → mark-paid (invoice + Eligible).
- Live headless smoke on the deployed happy path per slice.

## 10. Out of scope (now)
- DOCX/other upload types beyond PDF/PNG/JPEG.
- E-signature *inside* the quotation (rep still sends out-of-band / uploads the
  signed copy).
- Reworking the payout/GIRO surfaces beyond the invoice-timing move.
- Multi-team conflict rules (an associate in multiple teams with different
  directors) — pick the single team's director; flag if ambiguous, don't
  auto-resolve silently.
