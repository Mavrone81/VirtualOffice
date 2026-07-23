# Sales workflow rework — parallel split + quotation, closure, verify

Confirmed workflow: see the annotated lifecycle diagram approved 2026-07-23.
Covers issues 1 (parallel flows + up-front quote fields), 1a (split approval SD→Admin,
separate tabs), 1b (admin-gated quotation generation), 2 (SD defaulted to team's first
director), 3 (restored admin Sales & Verify + per-plan payment marking), 4 (post-approval
doc upload + associate closure).

## Core change to the money path
Today `approveQuotation` mints the SalesTransaction + invoice + commission at approval.
**New:** the two approval flows only record sign-offs; the transaction / commission ledger /
invoice are minted at **closure** (`closeSale`, by the associate). "Closed" is signalled by
the transaction existing — no new enum value, so existing prod `QuotationApproved` rows
(which already carry a transaction) read as closed and appear in Verify unchanged.

## Status / flags (SalesSubmission)
- `status` tracks **flow B only**: `Submitted` → (admin approves generation) → `QuotationApproved`.
  `Rejected` unchanged. Closure is the transaction, not a status.
- **Flow A (split), parallel, timestamp-driven:** `sdApprovedAt/ById` (exists, SD step, 3-day auto)
  → new `splitAdminApprovedAt/ById` (admin step).
- New `splitDirectorId` — per-submission SD, defaulted from the closer's team (first team with a
  director; fallback = upline SD). Admin-reassignable.
- New `quoteDate` (date of quote). Installment plan constrained to **12 or 24** (reuses `installmentCount`).
- New `closedAt/ById` — closure audit.

## Actions (server/sales/actions.ts)
- `submitSale` — capture `quoteDate`, plan (Full/12/24), resolve+store `splitDirectorId`.
- `approveSubmissionSplit` (SD, exists) → new `adminApproveSplit` (admin second sign-off; stamps
  `sdApprovedAt` if it was a 3-day auto).
- `approveQuotation` — no longer creates the transaction; just `status=QuotationApproved` (flow B).
  **Ungated from split** (parallel).
- new `closeSale` — associate; requires `status=QuotationApproved` + `splitAdminApprovedAt` + a Signed
  doc + no existing transaction → mints transaction + commission (PendingCollection) + invoice/schedule;
  sets `closedAt`.

## Pages
- Submission form: quote-date field; plan dropdown Full / 12 mo / 24 mo.
- `/portal/approvals` (SD tab) — filter by `splitDirectorId`.
- new `/admin/split-approvals` (admin tab) — SD-approved queue awaiting admin split sign-off.
- `/admin/quotations` — ungate from split; queue = `status=Submitted`.
- `/portal/quotations` — add **Close sale** (gated) alongside the existing docket upload.
- rebuild `/admin/sales/verify` — closed sales, all docs, mark payments per plan (reuse MarkPaidButton),
  restore its nav item.

## Migration (additive, CI auto-applies on push)
New nullable columns; backfill `splitDirectorId` for in-flight `Submitted` rows from their team.
No money values touched; existing invoices/transactions untouched.
