# Test Plan & QA Strategy — Enshrine Associate Management Portal

**Version:** 1.0 · **Source of truth:** `Enshrine_Portal_PRD.md` v1.2 (§8 engine, §14 acceptance, §15 test plan) · **Canonical references:** `05_RBAC.md` (§6 test cases), `02_Database_Diagram.md` (enums, constraints)
**Stack:** Next.js (App Router, TypeScript), PostgreSQL + Prisma, NextAuth/Auth.js.

---

## 1. Objectives & scope

Verify that the portal correctly implements: the **installment-aware commission engine** (the single highest-risk component), the **submit → verify → invoice → engine → payout → bank-file** pipeline, **RBAC downline scoping**, and **data integrity** (immutable history, idempotent runs, unique numbering, money reconciliation). The commission math must reconcile to the cent (PRD §14: zero rounding leakage).

Out of scope for v1 testing (deferred features): payment gateway, AI festive generator, full Vendor/Logistics LMS.

---

## 2. Test levels

| Level | What it covers | Where |
|---|---|---|
| **Unit** | Commission engine math (§8), override-by-rank, add-on percentage/absolute, eligibility/installment threshold, rounding reconciliation, ID & invoice-number sequencing, cycle detection, GST-off math, zod validators, masking serializers | `src/**/*.test.ts` |
| **Integration** | Full pipeline against a real Prisma test DB; verification side-effects (upline snapshot, structure-version resolution); installment mark-paid → engine re-run; invoice numbering atomicity | Vitest + Prisma test DB |
| **E2E** | Browser flows: recruit → e-sign → approve → login → submit → verify → invoice → mark paid → run engine → payout → bank file | Playwright |
| **Permission** | RBAC matrix server-side; 403 on out-of-scope; PII masking; manual-override Admin-only; gating overlay | Vitest (API) + Playwright |
| **Regression** | Structure versioning immutability; idempotent re-runs; installment-adjust preserves paid history; multi-company numbering | Re-run on every release |

---

## 3. Tooling

- **Unit/Integration:** **Vitest** (or Jest) for TypeScript. Pure functions in the engine isolated from I/O so the §8.2 example runs without a DB.
- **E2E:** **Playwright** (multi-role sessions, file-upload, PDF assertions).
- **Database:** dedicated **Prisma test DB** (ephemeral Postgres, e.g. Docker/`pg-mem` for fast cases, real Postgres for integration). `prisma migrate reset` + seed fixture before each integration run; wrap each test in a transaction or truncate between tests.
- **Fixtures:** seed the 7 prototype associates (EN0001–EN0007), ≥1 company (Enshrine), and products including one **external** (columbarium) — mirrors `02_Database_Diagram.md` §5.
- **Coverage gate:** commission engine and RBAC scoping ≥ 90% line/branch.

---

## 4. Commission engine unit tests

The engine is pure given `(sale_amount, structure, ticked com_codes, closer, upline snapshot)` per PRD §8.1. All amounts SGD, 2 dp, residual pushed into Company Retained.

### 4.1 Worked example (CE-01, must pass — PRD §8.2 / §14)
Input: `sale_amount = 10,000`; `closing_comm_pct = 10`; `company_cut_pct = 40`; direct upline = SM (`sm_override_pct = 20`), 2nd upline = SD (`sd_override_pct = 10`); both Approved+Active.

| Component | Expected |
|---|---|
| Closing Commission (10%) | **$1,000.00** |
| Company Cut Pool (40%) | **$400.00** |
| Net to closer (Personal) | **$600.00** |
| SM Override (20% of 400) | **$80.00** |
| SD Override (10% of 400) | **$40.00** |
| Company Retained | **$280.00** |
| **Reconciliation** | `600 + 80 + 40 + 280 = 1000` ✓ |

Assert exact `ledger_line_type` rows: one `Personal` ($600), two `Override` ($80 SM, $40 SD), one `Company Retained` ($280).

### 4.2 Override-by-rank (CE-02)
- `override_pct_for_rank`: ASM→`asm_override_pct`, SM→`sm_override_pct`, SD→`sd_override_pct`, Consultant→0.
- Upline that is **not** Approved+Active produces **no** override line (its share stays in Company Retained).
- Chain depth = 2 (direct + 2nd upline) per default; null/`-` upline (division head) handled.

### 4.3 Add-on com codes (CE-03)
- **Percentage** add-on: `round2(sale_amount * value/100)` (basis = sale, default; flag for basis = commission). e.g. 2% of $10,000 = **$200.00**.
- **Absolute** add-on: face value, e.g. `$20`, `$0.28` → **$20.00**, **$0.28**.
- Attribution defaults to **closer**; produces `Add-on` ledger line(s) per `com_code`, additive on top of the core split (does not reduce the $600/$80/$40/$280).
- Only **verified** add-ons compute; an unverified/inactive add-on produces nothing.

### 4.4 External-product branch (CE-04 — PRD §8.5)
For `is_external = true` (columbarium/niche/memorial):
- Standard pool/override model **does not** apply.
- Bulk → `External Payable` line (to provider/"Shifu", `associate_id` null).
- Enshrine keeps only `external_company_retained_pct` → `Company Retained` line.
- Optional small `Personal`/`Override` paid only from the retained cut.

### 4.5 Manual override (CE-05 — PRD §8.6)
- An Admin-set manual amount supersedes the computed line; sets `is_manual_override = true`, requires `override_reason`.
- Reconciliation assertion is **relaxed** for manually-overridden lines, but transaction total is still recorded; manual entry is audit-logged.

### 4.6 Installment 3rd-payment trigger (CE-06 — PRD §8.3)
- `Full Payment`: `Eligible` once verified + fully collected.
- `Installment`: `Pending Collection` until the configured milestone — **default = 3rd installment paid** (`commission_payout_installment_threshold`). On the 3rd installment marked Paid → eligibility flips to `Eligible` (all-or-nothing default; flag for pro-rata).
- `payout_month` = month commission became eligible.
- Marking installments 1 and 2 Paid does **not** make commission payable; marking the 3rd does.

### 4.7 Rounding reconciliation (CE-07)
- Use values that force rounding (e.g. odd cents, 3-way pool splits) and assert `net_to_closer + total_override + company_retained == closing_commission` exactly, residual absorbed by Company Retained — **zero rounding leakage** (PRD §14).

### 4.8 Idempotency / rate change (CE-08)
- Re-running the engine for a transaction produces **no duplicate** ledger lines (delete+reinsert per transaction, DB §4).
- A structure rate change creates a new version effective from a date; a transaction with earlier `sales_date` keeps old rates — historical/paid lines never recomputed (PRD §8.4).

---

## 5. Integration test — full pipeline (IT-01)

End-to-end against the Prisma test DB (PRD §15 integration):

1. Recruit associate → `approval_status = Pending`, `associate_status = Inactive`, code `EN####`, auto agreement generated.
2. E-sign → `signed_agreement_file_key` set.
3. Approve + Activate → login provisioned; appears downstream.
4. Submit sale (with ticked add-ons) → `sales_submissions.status = Submitted`.
5. Verify → `sales_transactions` created: unique `transaction_code`, **upline snapshot**, structure version resolved by `sales_date`, eligibility computed.
6. Generate invoice(s) → unique per-company `invoice_number`; installment plan auto-schedules (installments sum to total).
7. Mark installments Paid up to threshold → eligibility recomputes.
8. Run engine → `commission_ledger` lines, reconciling.
9. Run payout → `monthly_payouts` aggregates `personal + override + addon = total_payable`; only `Eligible` lines roll in.
10. Generate bank GIRO file → matches selected payouts; marking `Paid` locks the row + stamps `paid_date`.

**Assertions:** no commission on any dashboard for an unverified submission (PRD §6.4); eligibility auto-updates on collection; bank file matches selected payouts exactly.

---

## 6. RBAC / permission test matrix

Mirrors `05_RBAC.md` §6. All checks are **server-side**; out-of-scope returns **403**, not empty 200.

| ID | Case | Expected |
|---|---|---|
| PERM-01 | Consultant requests another associate's ledger | **403** |
| PERM-02 | SM queries an associate outside their downline closure | **403** (not empty list) |
| PERM-03 | Pending/Inactive associate offered as selectable closer / in payout / in dashboard | Never appears |
| PERM-04 | Accounts attempts manual commission override | **403** (Admin-only) |
| PERM-05 | `nric` / `bank_account_number` returned to SD/SM/Consultant | **Masked** (`S****892A`, `••••3210`) |
| PERM-06 | Role escalation via tampered client payload | Rejected (server re-checks) |
| PERM-07 | SD/SM/Consultant attempts `Run commission engine` / `Generate bank file` | **403** (Accounts+ only) |
| PERM-08 | Consultant attempts to verify a sale | **403** |
| PERM-09 | Associate edits vendor referral registry | **403** (view-only; Admin/Accounts edit) |
| PERM-10 | Manager dashboard tiles include only downline-closure associates | Scope-correct, reconciles to ledger |

---

## 7. Data-integrity tests

| ID | Case | Expected |
|---|---|---|
| DI-01 | **Cycle prevention** — assign upline that creates a loop | Rejected (PRD §6.1, DB constraint) |
| DI-02 | Upline must exist (or be null/`-` for division head) | Non-existent upline rejected |
| DI-03 | **Unique invoice numbers** per company; concurrent issuance | No duplicates; `invoice_next_seq` allocated atomically |
| DI-04 | Sequential immutable `associate_code` (`EN####`); no gaps from concurrent recruit | Unique, sequential, immutable |
| DI-05 | **Idempotent engine re-run** after each installment payment | No duplicate ledger lines |
| DI-06 | Installment schedule sums to total; final-installment residual handling | Sum == total |
| DI-07 | Editing a plan mid-way preserves paid history; only remaining recomputes | Paid amounts unchanged |
| DI-08 | `amount_collected <= sale_amount` check | Violation rejected |
| DI-09 | `monthly_payouts` unique `(associate_id, payout_month)` | Duplicate rejected |
| DI-10 | Marking payout/invoice `Paid` locks the row | Subsequent edit rejected |
| DI-11 | Pool override validation `ASM% + SM% + SD% + Company Retained% = 100%` of pool | >100% rejected (PRD §6.5) |

---

## 8. Traceability — PRD §14 acceptance criteria → test cases

| PRD §14 acceptance criterion | Test case(s) |
|---|---|
| §8.2 example → $600/$80/$40/$280, reconciles to $1,000 | **CE-01** |
| Add-on com codes (percentage & absolute) compute & attribute correctly | **CE-03** |
| Pending/Inactive/unverified never a closer, in payout, or another manager's dashboard | **PERM-03, IT-01 (step 5)** |
| Installment commission payable only at threshold (default 3rd), recomputes on mark-paid | **CE-06, IT-01 (step 7)** |
| Invoices issue per-company unique numbers; computer-generated shows no-signature footer | **DI-03, IT-01 (step 6)** |
| Editing a rate from a date never alters historical payouts | **CE-08** |
| Re-running the engine is idempotent | **CE-08, DI-05** |
| Bank payout file matches selected payouts & validates against bank format | **IT-01 (step 10)** |
| Managers/consultants strictly scoped; out-of-scope = 403 | **PERM-01, PERM-02, PERM-07, PERM-10** |
| Money reconciles with zero rounding leakage | **CE-07** |

---

## 9. Entry & exit criteria

**Entry (a build is testable):** app builds; migrations apply cleanly to the test DB; seed fixture loads; auth works for all five roles.

**Exit (a release passes QA):**
- All CE-, IT-, PERM-, DI- cases green; 0 open Sev-1/Sev-2 defects.
- §14 traceability table fully covered.
- Coverage gate met (engine & RBAC ≥ 90%).
- E2E happy path green across Admin, Accounts, SD, SM, Consultant.
- Money reconciliation tests show zero leakage.

---

## 10. UAT checklist

Run with Admin (Samuel/Enshrine ops) before each phase sign-off:

- [ ] Recruit a new associate; confirm `EN####`, auto-agreement, e-sign, approve+activate opens login; first login forces photo.
- [ ] Cyclic upline assignment is rejected.
- [ ] Submit a sale with add-on com codes ticked; verify it; confirm transaction ID + upline snapshot.
- [ ] Generate a computer-generated invoice (no-signature footer) and a signature invoice under the correct company stamp.
- [ ] Create an installment plan; confirm schedule sums to total; mark installments paid; confirm commission becomes payable at the 3rd.
- [ ] Run the engine on the §8.2 example; confirm $600 / $80 / $40 / $280.
- [ ] Apply a manual commission override with a reason; confirm it is flagged and audit-logged.
- [ ] Run a monthly payout; confirm totals; generate the bank GIRO file; mark Paid and confirm the row locks.
- [ ] Log in as SM and confirm only downline data is visible; attempt out-of-scope access → 403.
- [ ] Confirm NRIC / bank account are masked for non-Admin/Accounts roles.
- [ ] Post a notice; confirm it appears in the home feed and emails the audience.
- [ ] Submit a vendor referral; confirm timestamped, view-only entry.

---

*References: `Enshrine_Portal_PRD.md` (master), `05_RBAC.md` §6 (permission cases), `02_Database_Diagram.md` (enums/constraints).*
