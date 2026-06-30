# User Requirements Document (URD) — Enshrine Associate Management Portal

**Product:** Enshrine Associate Management Portal — a CRM + HRMS "virtual office"
**Document:** User Requirements Document (URD)
**Version:** 1.2
**Source of truth:** `Enshrine_Portal_PRD.md` v1.5 (PRD); aligned with `02_Database_Diagram.md` (entities/enums) and `05_RBAC.md` (roles/scoping)
**Owner:** Samuel (builder / Product Owner) for Enshrine
**Region context:** Singapore (NRIC, PayNow, PDPA, GIRO, GST when applicable)
**Date:** 28 June 2026
**Target builder:** Codex (Next.js + PostgreSQL + Prisma)

---

## 1. Purpose & Scope

### 1.1 Purpose
This URD captures **what users need from the system and why**, expressed in their own terms. Where the PRD answers *"what to build and how"* (product/technical), this URD answers *"who needs what outcome, and how we know it's met."* It is the user-facing, requirements-traceable bridge between business intent and the technical PRD.

Concretely it provides:
- Stakeholders and personas, with their goals.
- Epics decomposed into **user stories** ("As a `<role>`, I want `<goal>`, so that `<benefit>`").
- **Acceptance criteria** (Given/When/Then) and a **MoSCoW** priority per story.
- A **use-case summary table** and a **traceability map** back to PRD sections.

### 1.2 Scope (v1)
In scope: the "virtual office" pipeline — **admin-initiated candidate onboarding** & e-sign, Associate Master / HR (with a **P-file** for every user), sales submission (with add-on com codes), sales verification & transactions, commission structure, invoicing & installments, the auto commission engine, monthly payout + bank GIRO file, dashboards, notices, a documents/agreements repository (including a **Sales Agreements** download tab for admin-uploaded vendor MOUs / sales agreements), a view-only vendor referral registry, and a **digital name card / VCF** for every user.

Out of scope for v1 (reflected as **Won't-have-v1** stories where user-relevant): payment-gateway integration, the AI festive/DM marketing generator (static templates only in v1), and the full Vendor/Supplier/Logistics Management System (LMS). GST is built **GST-ready but default off** (revenue < S$1M). The public marketing website is a separate deliverable.

### 1.3 Intended readers
- **Samuel / Product Owner** — to confirm requirements reflect business intent.
- **Codex (builder)** — to derive features, acceptance tests, and phase scope.
- **Accounts / HR** and **Sales leadership (SD/SM)** — to validate that stories match how they work.
- **QA** — to turn acceptance criteria into test cases.

---

## 2. Stakeholders & Personas

Application roles use the canonical `app_role` names from `05_RBAC.md`: **Admin**, **Accounts**, **SalesDirector**, **SalesManager**, **Consultant**. Org rank uses the `designation` enum: Sales Consultant, Assistant Sales Manager, Sales Manager, Sales Director. `designation` (rank) is distinct from `role` (permission).

### 2.1 Internal personas (system users)

| Persona | App role (`app_role`) | Who they are | Primary concerns |
|---|---|---|---|
| **Admin / Product Owner (Samuel)** | `Admin` | Owner-operator who configures the whole system. | Set up companies, products, com codes, commission rates/versions, users; run the engine; manage payouts and the bank file; manual override for edge cases. |
| **Accounts / HR Verifier** | `Accounts` | Finance/HR ops staff (may be merged with Admin early in v1). | Verify sales, manage invoices/payments, mark installments paid, manage payouts, key HR detail, post notices. |
| **Sales Director (SD)** | `SalesDirector` | Head of a division (e.g. Sylvia Lee, Vincent Lim). | Self-service office; full-downline visibility; own sales & invoices; team performance. |
| **Sales Manager (SM)** | `SalesManager` | Override-tier leader of a smaller team. | Same as SD but scoped to own (smaller) downline. |
| **Sales Consultant** | `Consultant` | Front-line closer. | Submit own sales, raise invoices, track own commissions/payouts, personal dashboard only. |

### 2.2 External actors (not system logins in v1)

| Actor | Role in the process | How they appear in the system |
|---|---|---|
| **Candidate / Applicant** | A prospective associate, normally created by Admin (name + mobile + email) or self-served via the public Recruitment Form. | Held as a `candidates` record through `onboarding_stage` {Invited → Form Submitted → Signed – Pending Approval → Approved/Rejected}; completes the tokenised Onboarding Form (no login), e-signs the auto-generated Associate Agreement, and on Approve is **converted** to an `associate` with a provisioned login. |
| **Customer / Client** | The buyer of a funeral / pet-aftercare package. | Named on submissions, transactions and invoices; may sign a Signature-type invoice (PDF download or, later, remote e-sign). No login in v1. |
| **External provider / "Shifu"** | Third party who supplies external products (columbarium niche, memorial placements). | Represented by **External Payable** ledger lines; receives the bulk of external-product value while Enshrine retains only a small maintenance cut. No login in v1. |
| **Vendor / referral partner** | A business an associate signs as a referral tie-up (e.g. groomer, distribution centre). | Recorded in the **Vendor Referral Registry** with a first-claim timestamp; visible view-only to all associates. |

---

## 3. User Goals per Persona

- **Admin / Product Owner (Samuel):** Configure the business once and trust the math. Approve associates; define products, com codes, overrides and effective-dated versions; run an idempotent, auditable commission engine; produce a single **bank GIRO file** to replace one-by-one transfers; resolve edge cases via manual override.
- **Accounts / HR Verifier:** Keep the official record clean and timely. Verify submissions, issue multi-company invoices, record installment payments manually, and drive payouts to "Paid" — all with an audit trail.
- **Sales Director / Sales Manager:** Run a virtual office for the whole team. See a downline-scoped dashboard, submit and invoice own sales, and watch personal + override earnings without seeing anyone outside their downline.
- **Sales Consultant:** Do everything from one login — submit a sale, raise an invoice, and see exactly what commission is pending vs payable, plus their own agreement, notices and the vendor directory.
- **Applicant:** Apply and e-sign online, with no office visit, and know the application status.
- **Customer:** Receive a clear, correctly-branded invoice and (where required) sign with minimal friction, including a download-and-sign path for elderly customers.

---

## 4. Epics → User Stories

Stories are grouped by module (epic). Each carries acceptance criteria in **Given/When/Then** form and a **MoSCoW** priority: **Must** / **Should** / **Could** / **Won't-have-v1**. Role names are the canonical `app_role` values; external actors are named explicitly.

---

### EPIC A — Candidate Onboarding & E-Sign (admin-initiated)
*(PRD §6.1, §6.1.2; entities `candidates`, `associates`, `users`, `p_files`/`pfile_documents`, `documents`)*

#### A-1 — Admin creates a candidate and the system emails an onboarding form · **Must**
**As an** Admin (or Accounts), **I want** to create a candidate with just basic info so the system emails them an onboarding form, **so that** I can start an associate's onboarding without collecting paperwork myself.
- **Given** the Candidates page, **when** an `Admin`/`Accounts` user enters at least full name, mobile number and email (optionally intended designation/upline/team), **then** a `candidates` row is created with `onboarding_stage = Invited` and a secure `onboarding_token`.
- **Given** a candidate at `Invited`, **when** the record is created, **then** the system emails the candidate a tokenised link to the Onboarding Form that requires **no login**.
- **Given** a missing name, mobile or email, **when** the Admin submits, **then** creation is rejected with field-level errors and no candidate is created.
- **Given** any candidate creation, **when** saved, **then** an `audit_log` entry records the actor (`invited_by`).

#### A-2 — Candidate completes the onboarding form and e-signs the auto-generated agreement · **Must**
**As a** Candidate, **I want** to complete the onboarding form via my emailed link and e-sign the auto-generated agreement, **so that** onboarding is paperless and I don't need to visit an office.
- **Given** a valid `onboarding_token`, **when** the candidate opens the link and completes the Onboarding Form (full associate detail set per §7.1 — NRIC, DOB, address, bank/PayNow — plus a profile photo), **then** the submission is stored (`submitted_payload`, `photo_file_key`) and `onboarding_stage = Form Submitted`.
- **Given** a `Form Submitted` candidate, **when** the form is submitted, **then** the Associate Agreement PDF is auto-generated from a template populated with the submitted details and stored (`agreement_file_key`).
- **Given** the generated agreement, **when** the candidate e-signs it in-app, **then** a signed PDF is stored (`signed_agreement_file_key`) and `onboarding_stage = Signed – Pending Approval`.
- **Given** a candidate who cannot sign on-screen, **when** they use the fallback, **then** a download-to-sign PDF path is always available and the signed copy can be re-uploaded.
- **Given** an expired or invalid token, **when** the link is opened, **then** access is denied (no associate data is exposed).

#### A-3 — Admin approves a signed candidate → Active associate with login · **Must**
**As an** Admin (or Accounts), **I want** to review and approve a signed candidate, **so that** they are converted into an Active associate with a virtual-office login.
- **Given** a candidate at `Signed – Pending Approval`, **when** an `Admin`/`Accounts` user **approves**, **then** the candidate is **converted** to an `associate` with the next sequential `associate_code` (`EN####`), `approval_status = Approved`, `associate_status = Active`, a login is provisioned, and the company-counter-signed agreement is filed into the associate's P-file (`pfile_documents.doc_type = Signed Associate Agreement`).
- **Given** a candidate at `Signed – Pending Approval`, **when** an `Admin`/`Accounts` user **rejects**, **then** `onboarding_stage = Rejected` with a `reject_reason`, no login is provisioned, and the candidate never appears downstream.
- **Given** a candidate (any stage before approval), **when** any module lists selectable closers, payout recipients or dashboard members, **then** the candidate is excluded (cannot log in beyond the onboarding form).
- **Given** any approve/reject, **when** saved, **then** an `audit_log` entry records the actor (`reviewed_by`) and before/after.

#### A-4 — Force a profile photo on first login · **Must**
**As an** Admin, **I want** the associate's first login to require a photo capture, **so that** profiles are complete and the (future) festive generator has an image.
- **Given** a newly-activated associate, **when** they log in for the first time, **then** login cannot complete until a photo is captured/uploaded (`photo_file_key`).

#### A-5 — HR keys additional onboarding detail · **Should**
**As an** Accounts/HR user, **I want** to add fields not captured by the form, **so that** tier-specific terms and payment details are complete.
- **Given** an associate record, **when** HR edits permitted fields, **then** changes save and are audit-logged.

---

### EPIC B — Associate Master / HR System
*(PRD §6.2, §6.2.1; entities `associates`, `p_files`, `pfile_documents`; RBAC scoping)*

#### B-1 — Maintain the associate master & hierarchy · **Must**
**As an** Accounts/HR user, **I want** to maintain each associate's details and upline hierarchy, **so that** commission and scoping are correct.
- **Given** an associate, **when** I set `direct_upline_id`, **then** `second_upline_id` auto-derives from the direct upline's direct upline, with manual override allowed.
- **Given** an upline assignment that would create a cycle, **when** I save, **then** it is rejected.
- **Given** an upline that does not exist, **when** I save, **then** it is rejected (or null/`-` allowed for division heads).

#### B-2 — Status changes retain history · **Must**
**As an** Admin, **I want** Terminated/Suspended to stop future eligibility but keep history, **so that** past payouts are never lost.
- **Given** an associate with paid history, **when** I set `associate_status = Terminated` or `Suspended`, **then** they become ineligible for **future** commission/payout but historical ledger lines remain intact.

#### B-3 — Enforce the gating rule everywhere · **Must**
**As an** Admin, **I want** only Approved+Active associates to act as closers, receive payouts, or appear in dashboards/exports, **so that** invalid records never leak into earnings.
- **Given** an associate not (`Approved` AND `Active`), **when** any module lists selectable closers, payout recipients, contacts export, or manager-dashboard members, **then** they are excluded.

#### B-4 — Export contacts · **Must**
**As an** Admin, **I want** a Google-Contacts-compatible CSV of qualifying associates, **so that** contact lists stay in sync.
- **Given** the export, **when** generated, **then** it includes associates where `approval_status = Approved` AND `associate_status ∈ {Active, Terminated}`, with columns Associate ID, Full Name, Designation, Email, Mobile, DOB, Status.

#### B-5 — Mask sensitive PII · **Must**
**As a** SalesDirector/SalesManager/Consultant, **I want** NRIC and bank account masked, **so that** PDPA-sensitive data is protected.
- **Given** a non-Admin/non-Accounts viewer, **when** they view an associate, **then** `nric` and `bank_account_number` are masked (e.g. `S****892A`); full values are served only to `Admin`/`Accounts`.

#### B-6 — Every user has a P-file holding their signed agreement & HR docs · **Must**
**As any** user (associate), **I want** a personnel file (P-file) that holds my signed agreement and HR documents and that I can view, **so that** I always have my own counter-signed copy and personnel records in one place.
- **Given** a candidate is approved and converted to an associate, **when** conversion occurs, **then** a `p_files` record is created (keyed on `user_id` so future permanent staff also get one) and the company-counter-signed agreement is filed automatically as a `pfile_documents` row (`doc_type = Signed Associate Agreement`).
- **Given** my own P-file, **when** I open it, **then** I can view/download my own documents (signed agreement, onboarding submission, ID/HR documents), with `nric`/`bank_account_number` masked per B-5.
- **Given** an `Admin`/`Accounts`/HR user, **when** they manage P-files, **then** they can file/remove documents for any user, and every filing/removal is `audit_log`ged.
- **Given** a `SalesDirector`/`SalesManager`, **when** they attempt to view a downline associate's P-file, **then** access is denied by default (P-files are HR-sensitive; managers do **not** see downline P-files).

---

### EPIC C — Sales Submission (multi-product line items, with add-on com codes)
*(PRD §6.3; entities `sales_submissions`, `sale_line_items`, `products`, `com_codes`, `companies`)*

#### C-1 — Submit a sale from the virtual office · **Must**
**As a** Consultant (or any role permitted to sell), **I want** to submit a sale with all details, **so that** it can be verified and earn commission.
- **Given** the submission form, **when** I submit with header fields (Sales Date, Client Name/Contact, Payment Type, payment plan, Amount Collected, Closing Associate) and at least one line item (Company Entity, Product Code, Line Sale Amount), **then** a `sales_submission` header plus its `sale_line_items` are created with `status = Submitted` (pending, not yet official), and total Sale Amount = sum of line amounts.
- **Given** `amount_collected > total sale_amount`, **when** I submit, **then** it is rejected.
- **Given** a closer who is not Approved+Active, or any line with an inactive product/add-on, **when** I submit, **then** it is rejected.

#### C-1b — Submit ONE sale containing MULTIPLE products, each computing its own commission · **Must**
**As a** Consultant (or any role permitted to sell), **I want** to add multiple products as separate line items on a single sale, **so that** a bundled deal is captured once and each product earns its own commission.
- **Given** the submission form, **when** I add two or more line items, **then** each line captures its own Product Code (resolving Product Name, Commission Type and rates — not free-typed), Company Entity, Line Sale Amount, optional quantity, and its own ticked add-on com codes.
- **Given** a multi-product submission, **when** it is verified and the engine runs, **then** commission is computed **per line item** (each using its own product, Commission Type, rates and com codes) and the transaction's commission = the **sum** of all line commissions, with each ledger line tagged to its `line_item_id` (PRD §8.1).
- **Given** a sale whose lines mix `commission_type = Percentage` and `commission_type = Fixed`, **when** the engine runs, **then** each line uses its own Commission Type basis while sharing the same company-cut/override split.
- **Given** any single line, **when** the engine completes it, **then** that line reconciles independently (`net_to_closer + total_override + company_retained == line closing_commission`).

#### C-2 — Tick applicable add-on com codes · **Must**
**As a** Consultant, **I want** to tick the add-on com codes that apply to the product, **so that** extra commission is captured at source.
- **Given** a product with active `com_codes`, **when** I tick add-ons (e.g. scattering, remembrance) at submission, **then** the selected codes are recorded for later verification — not free-typed, only from the active structure.

#### C-3 — Choose installment terms · **Must**
**As a** Consultant, **I want** to choose Full Payment or Installment with deposit and number of installments, **so that** the plan and schedule can be generated.
- **Given** `payment_plan = Installment`, **when** I enter deposit and installment count, **then** the values are validated (positive deposit ≤ total, installment count ≥ 1) before submission is accepted.

---

### EPIC D — Sales Verification & Transactions
*(PRD §6.4; entity `sales_transactions`)*

#### D-1 — Verify a submission into an official transaction · **Must**
**As an** Accounts/HR user, **I want** to verify a submission, **so that** it becomes the authoritative record and commission can flow.
- **Given** a `Submitted` submission, **when** an `Admin`/`Accounts` user verifies it, **then** a `sales_transaction` is created with a unique `transaction_code`, `verified_by`/`verified_at` set, and the submission marked `Verified`.
- **Given** verification, **when** it runs, **then** the upline chain (`direct_upline_id`, `second_upline_id`) is **snapshotted** onto the transaction and the commission structure version is resolved by Sales Date.

#### D-2 — No commission before verification · **Must**
**As an** Admin, **I want** unverified submissions to never show commission, **so that** dashboards reflect only confirmed sales.
- **Given** an unverified submission, **when** any dashboard or ledger is viewed, **then** no commission appears for it.

#### D-3 — Eligibility auto-updates as collections are recorded · **Must**
**As an** Accounts/HR user, **I want** eligibility to recompute as payments come in, **so that** payable status is always current.
- **Given** a verified transaction, **when** an installment is marked Paid, **then** `commission_eligibility` recomputes per the rules (EPIC G).

---

### EPIC E — Commission Structure (products, Commission Type, com codes, upgrades, internal vs external)
*(PRD §6.5, §8.1, §8.4, §8.5; entities `products`, `com_codes`, `commission_structure_versions`)*

#### E-1 — Manage per-product commission rules · **Must**
**As an** Admin / Product Owner, **I want** to define each product's commission rules, **so that** the engine computes correctly.
- **Given** a product, **when** I set Closing Comm %, Company Cut %, ASM/SM/SD Override % and category, **then** the structure is saved with Company Retained % derived by default (`100% − overrides` of the pool).
- **Given** overrides + Company Retained that exceed 100% of the pool, **when** I save, **then** it is rejected.

#### E-1b — Choose a product's Commission Type (Percentage or Fixed) · **Must**
**As an** Admin / Product Owner, **I want** to create a product choosing its Commission Type — `Percentage` or `Fixed` — and supply the matching rate field, **so that** flat-fee products and percentage products both compute correctly while sharing the same override structure.
- **Given** the product form, **when** I create a product, **then** I must choose `commission_type ∈ {Percentage, Fixed}` and supply the matching rate field: `Percentage` requires `closing_comm_pct` (and ignores `closing_comm_fixed`); `Fixed` requires `closing_comm_fixed` (and ignores `closing_comm_pct`).
- **Given** `commission_type = Percentage` with no `closing_comm_pct`, **or** `commission_type = Fixed` with no `closing_comm_fixed`, **when** I save, **then** it is rejected with a field-level error.
- **Given** either Commission Type, **when** the structure is saved, **then** the **same** company-cut pool + ASM/SM/SD override + Company Retained split applies downstream (the type only changes how the closing commission is derived) (PRD §6.5/§8.1).
- **Given** a `Fixed` product with `closing_comm_fixed = $500`, company cut 40%, SM 20%, SD 10%, **when** the engine later runs a line for it, **then** it yields pool $200, closer $300, SM $40, SD $20, retained $140 (reconciles to $500).

#### E-2 — Manage add-on com codes per product · **Must**
**As an** Admin / Product Owner, **I want** to attach add-on com codes to a product, **so that** salespeople can tick valid add-ons.
- **Given** a product, **when** I add a com code with `value_type ∈ {Percentage, Absolute}` and a value (e.g. 2%, $20, $0.28) and active flag, **then** only active codes are selectable at submission.

#### E-3 — Model product upgrades / cascades · **Should**
**As an** Admin / Product Owner, **I want** to model upgrade/add-on products related to a base product, **so that** each upgrade's commission is attributed correctly.
- **Given** a base product, **when** I link an upgrade product via `parent_product_id`, **then** the upgrade carries its own commission and is computed and attributed as its own line.

#### E-4 — Flag internal vs external products · **Must**
**As an** Admin / Product Owner, **I want** to mark products Internal or External, **so that** external (columbarium/niche/memorial) economics are handled differently.
- **Given** an External product (`is_external = true`), **when** the engine runs, **then** the bulk is routed to an **External Payable** line (to the external provider / "Shifu") and Enshrine retains only `external_company_retained_pct`, not the full override pool.

#### E-5 — Version rates by effective date · **Must**
**As an** Admin, **I want** rate edits to create a new effective-dated version, **so that** historical payouts never change.
- **Given** an existing rate, **when** I edit it effective from a date, **then** a new `commission_structure_versions` row is created and only transactions with Sales Date ≥ effective date use the new rate; prior transactions and paid ledger lines are unchanged.

---

### EPIC F — Invoicing & Installments
*(PRD §6.5b; entities `companies`, `invoices`, `installment_plans`, `installment_schedule`)*

#### F-1 — Issue multi-company invoices · **Must**
**As an** Accounts/HR user (or the owning salesperson for own sales), **I want** invoices issued under the chosen company entity, **so that** each brand bills correctly.
- **Given** a transaction line with a Company Entity, **when** I issue an invoice, **then** it receives a unique number from that company's sequence (`INV-<COMPANY>-YYYY-#####`) and a PDF carrying that company's stamp.

#### F-1b — A multi-entity sale produces an invoice per company entity · **Must**
**As an** Accounts/HR user, **I want** a sale whose line items span different Company Entities to produce one invoice per entity, **so that** each legal entity bills only its own products correctly.
- **Given** a verified transaction whose `sale_line_items` reference more than one `company_id`, **when** invoices are issued, **then** lines are **grouped by Company Entity** and **one invoice is generated per entity** (by default), each numbered from its own company's sequence and stamped with that company.
- **Given** a sale whose lines all reference a single Company Entity, **when** invoices are issued, **then** exactly one invoice is generated for that entity.
- **Given** the per-entity grouping, **when** the invoices are produced, **then** each invoice's amount equals the sum of its own entity's line amounts, and the invoices together reconcile to the transaction's total Sale Amount (consolidated single-invoice is the alternative mode — PRD §6.5b).

#### F-2 — Support both invoice types · **Must**
**As an** Accounts/HR user, **I want** computer-generated and signature invoices, **so that** I can issue the right document.
- **Given** a Computer-Generated invoice, **when** generated, **then** the PDF shows the footer "This is a computer-generated invoice; no signature required."
- **Given** a Signature invoice, **when** generated, **then** a download-to-sign PDF path is always available; a signed copy can be uploaded (`signed_pdf_file_key`).

#### F-3 — Auto-calculate the installment schedule · **Must**
**As a** Consultant, **I want** the system to compute the installment schedule from total, deposit and count, **so that** I don't calculate by hand.
- **Given** total, deposit and installment count, **when** the plan is created, **then** the schedule auto-generates one invoice per installment using `installment = round((total − deposit) / n)` with residual on the final installment, and the installments sum exactly to the total.

#### F-4 — Outstanding tab and Mark-as-Paid · **Must**
**As an** Accounts/HR user, **I want** an Outstanding invoices tab with a Mark-as-Paid action, **so that** I can record manual payments (no gateway in v1).
- **Given** the Outstanding tab, **when** I view it, **then** all unpaid invoices are listed.
- **Given** an outstanding invoice/installment, **when** I Mark as Paid, **then** its status flips to `Paid`, `paid_date` is stamped, and eligibility feeds the engine idempotently.

#### F-5 — Adjust an installment plan mid-way · **Should**
**As an** Accounts/HR user, **I want** to renegotiate a plan, **so that** changed customer terms are honoured without losing paid history.
- **Given** a plan with some installments paid, **when** I adjust the remaining terms (e.g. 300/300/300/100 → 600/600/400), **then** previously-paid amounts are preserved and only the remaining schedule recomputes.

#### F-6 — Merge invoices · **Could**
**As an** Accounts/HR user, **I want** to merge two invoice numbers, **so that** duplicated billing can be tidied.
- **Given** two invoices, **when** I request a merge, **then** v1 provides a simple "close & re-issue/inverse" path (full merge deferred to a later phase).

---

### EPIC G — Auto Commission Engine (installment-aware)
*(PRD §6.6, §8.1–§8.6; entity `commission_ledger`)*

#### G-1 — Compute commission correctly per line (worked examples) · **Must**
**As an** Admin, **I want** the engine to compute closer, overrides, retained and add-ons exactly for each line item, **so that** payouts are trustworthy.
- **Given** a single Percentage-type line of $10,000 at 10% closing, 40% company cut, SM direct upline (20%), SD 2nd upline (10%), **when** the engine runs, **then** it yields closer $600, SM override $80, SD override $40, company retained $280, reconciling to $1,000.
- **Given** a single `Fixed`-type line with `closing_comm_fixed = $500`, 40% company cut, SM 20%, SD 10%, **when** the engine runs, **then** the Commission Type branch sets closing commission to the flat $500 and the same split yields pool $200, closer $300, SM override $40, SD override $20, retained $140, reconciling to $500.
- **Given** a multi-product transaction, **when** the engine runs, **then** it computes each line independently and the transaction totals = the sum across lines.
- **Given** any line, **when** computed, **then** `net_to_closer + total_override + company_retained == closing_commission` for that line (residual pushed into Company Retained; zero rounding leakage).

#### G-2 — Apply add-on com codes · **Must**
**As an** Admin, **I want** verified add-ons added on top, **so that** extra commission is paid.
- **Given** verified add-ons on a line, **when** computed, **then** Percentage codes = % of that line's sale amount (default basis) and Absolute codes = fixed $, each added as an Add-on ledger line (tagged to the `line_item_id`) attributed to the closer (default).

#### G-3 — Gate payable on installment milestone · **Must**
**As an** Admin, **I want** installment commission to become payable only at the configured milestone, **so that** we don't pay before collecting.
- **Given** an installment transaction, **when** fewer than the threshold installments (default: **3rd installment**) are paid, **then** eligibility is `Pending Collection`.
- **Given** the threshold installment is marked Paid, **when** the engine re-runs, **then** the commission becomes `Eligible` and `payout_month` is set to the month it became eligible.

#### G-4 — Idempotent, re-runnable engine · **Must**
**As an** Admin, **I want** safe re-runs, **so that** repeated runs never duplicate or rewrite history.
- **Given** a transaction already laddered, **when** the engine re-runs, **then** ledger lines are recomputed (delete+reinsert per transaction) with no duplicates, and paid/historical lines under prior rate versions are untouched.

#### G-5 — Handle external-product payouts · **Must**
**As an** Admin, **I want** external products to route to the provider with a small retained cut, **so that** columbarium/niche/memorial economics are correct.
- **Given** an External product, **when** computed, **then** ledger lines are `External Payable` (provider) + `Company Retained` (Enshrine's small cut) + optional small Personal/Override drawn only from the retained cut.

#### G-6 — Manual commission override · **Must**
**As an** Admin, **I want** to manually key an override/commission amount on a transaction, **so that** complex cascade/external cases can be resolved.
- **Given** a transaction, **when** an `Admin` sets a manual amount with a reason, **then** `is_manual_override = true`, the manual value supersedes the computed one, reconciliation assertions are relaxed for that line, and the action is audit-logged. (Only `Admin` may do this; `Accounts` → 403.)

---

### EPIC H — Monthly Payout + Bank GIRO File
*(PRD §6.8; entities `monthly_payouts`, `bank_file_batches`)*

#### H-1 — Aggregate eligible commission per associate · **Must**
**As an** Accounts/HR user, **I want** eligible ledger lines aggregated per associate per month, **so that** payout totals are correct.
- **Given** a payout month, **when** I build payouts, **then** for each associate `total_payable = personal_commission + override_commission + addon_commission`, including only `Eligible` lines, with `UK (associate_id, payout_month)`.

#### H-2 — Generate the bank GIRO bulk-payout file · **Must**
**As an** Accounts/HR user, **I want** a single GIRO/bank file (and CSV) for the selected payouts, **so that** I stop doing one-by-one transfers.
- **Given** selected payouts, **when** I generate the bank file, **then** the file matches the selected payouts exactly, validates against the bank format, and groups them under a `bank_file_batches` record. (Associate payout only — vendor/supplier payments excluded.)

#### H-3 — Payout status workflow with lock on Paid · **Must**
**As an** Accounts/HR user, **I want** a Pending → Approved → Paid workflow, **so that** payout state is controlled and immutable once paid.
- **Given** a payout, **when** moved Pending → Approved → Paid, **then** marking Paid stamps `paid_date` and locks the row; `Cancelled` is terminal. (Held items simply remain `Pending`; there is no separate Hold status.)

#### H-4 — Generate per-associate payout statements · **Should**
**As an** Accounts/HR user, **I want** a PDF statement per associate per month, **so that** associates can see their breakdown.
- **Given** a built payout, **when** generated, **then** a statement PDF is produced and linked (`statement_file_key`).

#### H-5 — Ad-hoc ("money-fall") payout run · **Should**
**As an** Admin, **I want** an ad-hoc run in addition to the monthly batch, **so that** payouts can be triggered when needed.
- **Given** an ad-hoc run, **when** triggered, **then** it produces payouts and a bank file the same way the monthly batch does.

---

### EPIC I — Dashboards (Personal / Manager / Director)
*(PRD §6.9; RBAC scoping)*

#### I-1 — Personal dashboard for every associate · **Must**
**As a** Consultant, **I want** my own performance and commission view, **so that** I can self-serve.
- **Given** my login, **when** I open my dashboard, **then** I see my monthly/YTD sales, my commission split (personal/override/add-on/pending/paid), and my recruitment/downline — and nothing outside my own scope.

#### I-2 — Manager dashboard scoped to downline · **Must**
**As a** SalesManager, **I want** a team dashboard limited to my downline, **so that** I can manage my team without seeing others.
- **Given** my login, **when** I open the team dashboard, **then** data is filtered to my downline closure (recursive CTE on `direct_upline_id`), and any out-of-scope request returns 403 (not an empty 200).

#### I-3 — Director dashboard for full downline · **Must**
**As a** SalesDirector, **I want** my full-division dashboard, **so that** I can run the division.
- **Given** my login, **when** I open the dashboard, **then** I see my full downline's performance, scoped server-side.

#### I-4 — Tiles reconcile with the ledger · **Must**
**As a** SalesManager, **I want** dashboard tiles to match the underlying data, **so that** I can trust the numbers.
- **Given** any dashboard tile, **when** rendered, **then** it reconciles with the commission ledger / transactions for the scoped set.

#### I-5 — Configurable team-detail visibility · **Could**
**As an** Admin, **I want** to configure whether consultants/managers reveal member-level detail, **so that** visibility matches policy.
- **Given** a visibility setting, **when** configured, **then** team-member-level detail is revealed or hidden accordingly (default: personal dashboard shown to all).

---

### EPIC J — Notices / Notifications
*(PRD §6.10; entities `notices`, `notice_reads`)*

#### J-1 — Post a notice to associates · **Must**
**As an** Accounts/HR user (or Admin), **I want** to post company notices, **so that** associates learn of changes (e.g. clause/code changes affecting pay).
- **Given** a notice with title, body and optional attachment and audience (`All`/`Team`/`Role`), **when** posted, **then** targeted associates are notified in-app (bell + count) and by email, and it renders in their home feed.

#### J-2 — Read notices on the home feed · **Must**
**As a** Consultant, **I want** notices on my home feed, **so that** I can re-read older announcements and keep attachments.
- **Given** posted notices, **when** I open my home page, **then** they appear scrollable (newest first); I can download and keep attachments myself (no per-user folder).

---

### EPIC K — Documents & Agreements Repository
*(PRD §6.11; entities `documents`, `p_files`/`pfile_documents`)*

#### K-1 — Access company agreement templates · **Must**
**As a** Consultant, **I want** to view/download company agreement templates, **so that** I can use the right document with vendors/customers.
- **Given** the repository, **when** I open it, **then** I see company templates (e.g. Referred Partnership Agreement, Cage Storage Agreement, funeral package agreements, associate agreement template) per visibility rules.

#### K-2 — Access "My Agreement" / P-file · **Must**
**As a** Consultant, **I want** to view/download my own signed Associate Agreement and personnel documents, **so that** I keep my counter-signed copy.
- **Given** my P-file (§6.2.1) holding my signed agreement (`pfile_documents.doc_type = Signed Associate Agreement`) and HR documents, **when** I open "My Agreement" / P-file, **then** I can view/download my own documents; others cannot see them (managers do not see downline P-files — see B-6).

#### K-3 — Admin uploads vendor MOUs / sales agreements; associates download from a Sales Agreements tab · **Must**
**As an** Admin (or Accounts), **I want** to upload vendor MOUs / sales agreements and assign them to a specific associate, a team, or all associates, **so that** associates can self-serve the agreement files they need.
- **Given** a `Vendor MOU` or `Sales Agreement` document, **when** an `Admin`/`Accounts` user uploads it and sets `assignment ∈ {All, Team, Associate}` (with `assigned_team`/`assigned_associate_id` as applicable), **then** it is stored and targeted accordingly.
- **Given** a targeted associate, **when** they open the **Sales Agreements** tab, **then** they see and can **download** documents assigned to them (by All / their Team / themselves), with **download-only** access (no edit/replace/revoke).
- **Given** a non-targeted associate, **when** they open the Sales Agreements tab, **then** the document is not visible to them.
- **Given** an `Admin`/`Accounts` user, **when** they manage these documents, **then** they can upload, assign, replace and revoke.

---

### EPIC L — Vendor Referral Registry (view-only)
*(PRD §6.13; entity `vendor_referrals`)*

#### L-1 — Register a vendor referral with first-claim timestamp · **Must**
**As a** Consultant, **I want** to register a vendor I've signed, **so that** my first-claim is recorded.
- **Given** the Referred Partnership Registration form with an agreement upload, **when** I submit, **then** a `vendor_referral` is created with `submitted_at` as the first-claim timestamp and `submitted_by_associate_id = me`.

#### L-2 — Browse the vendor directory (view-only) · **Must**
**As a** Consultant, **I want** a view-only directory of registered vendors, **so that** I avoid double-approaching the same vendor.
- **Given** the registry, **when** I browse it, **then** I see all entries read-only; only `Admin`/`Accounts` may edit. Earlier `submitted_at` wins first-claim.

#### L-3 — Full vendor/logistics LMS · **Won't-have-v1**
**As an** Admin, **I want** WhatsApp/email audit trails, backup-supplier routing and vendor payments, **so that** vendor logistics are managed end-to-end.
- **Note:** Out of scope for this portal (separate future product). The registry is designed so it can later feed the LMS.

---

### EPIC M — Festive / DM Marketing Generator
*(PRD §6.12)*

#### M-1 — Download static marketing templates · **Should**
**As a** Consultant, **I want** to download festive/DM templates and add my own details, **so that** I can market to customers in v1.
- **Given** the Festive/Events tab, **when** I open it, **then** I can download static templates and add my own name/photo/number manually.

#### M-2 — AI-personalised marketing image generation · **Won't-have-v1**
**As a** Consultant, **I want** the system to auto-generate a personalised marketing image from my name/photo/contact, **so that** I save design effort.
- **Note:** Deferred (requires a paid AI image service). First-login photo (A-4) feeds this when enabled.

---

### EPIC O — Digital Name Card / VCF
*(PRD §6.14; entity `name_cards` — mostly derived from profile + company entity)*

#### O-1 — View and download my own digital name card · **Must**
**As any** user, **I want** to view my digital name card and download it as a `.vcf` and a rendered image/PDF, **so that** I can share my contact details in the Enshrine business-card style.
- **Given** the "My Name Card" tab, **when** I open it, **then** the card is auto-populated from my profile (name incl. Chinese name if present, designation/title, mobile, email, my company entity, company address `74 Lorong 6 Geylang, Singapore 399226`, web/Facebook, logo and a QR code) and rendered in the Enshrine template.
- **Given** my name card, **when** I download the `.vcf`, **then** a valid vCard (3.0/4.0 with FN, N, TITLE, ORG, TEL, EMAIL, ADR, URL, PHOTO) is produced that imports cleanly into a phone/email contact app.
- **Given** my name card, **when** I download the image/PDF, **then** a rendered card (PNG/PDF) in the Enshrine template is produced.
- **Given** I edit my profile, **when** the card is next viewed/downloaded, **then** it reflects my current name, designation, mobile, email and company entity.

#### O-2 — Admin can view any user's name card · **Should**
**As an** Admin, **I want** to view any user's name card, **so that** I can verify or share contact details on their behalf.
- **Given** an `Admin`, **when** they open a user's name card, **then** it renders the same as the owner's; non-owners other than `Admin` cannot view another user's card.

---

### EPIC N — Cross-cutting: Payments, Security, Audit

#### N-1 — Payment-gateway integration · **Won't-have-v1**
**As an** Accounts/HR user, **I want** customers to pay online via a gateway, **so that** payments are captured automatically.
- **Note:** Deferred (gateways cost ~2–3%). v1 records payments manually via Mark-as-Paid (F-4); re-evaluate by volume/investor.

#### N-2 — Server-side RBAC and scoping on every request · **Must**
**As an** Admin, **I want** permissions and scope enforced server-side, **so that** access cannot be bypassed via the client.
- **Given** any request, **when** it is served, **then** `can(principal, action, resource)` is checked server-side and scoped reads inject the downline-closure/self predicate; tampered client role claims are rejected.

#### N-3 — Audit log for privileged actions · **Must**
**As an** Admin, **I want** every privileged action audit-logged, **so that** the system is accountable.
- **Given** an approve/verify/engine-run/manual-override/mark-paid/rate-change/payout-status-change, **when** it occurs, **then** an `audit_log` row records actor and before/after.

#### N-4 — GST-ready, default off · **Should**
**As an** Admin, **I want** invoice/commission math GST-ready but off, **so that** we comply now and can enable GST later.
- **Given** GST disabled (default, revenue < S$1M), **when** invoices/commissions compute, **then** no GST is applied; enabling the toggle + rate applies GST without code change.

---

## 5. Use-Case Summary Table

| UC ID | Use case | Primary actor | Precondition | Main flow (summary) |
|---|---|---|---|---|
| UC-01 | Create candidate & email onboarding form | Admin / Accounts | Candidates page available | Enter name + mobile + email → `candidates` row at `onboarding_stage = Invited` → system emails tokenised Onboarding Form link (no login). |
| UC-01b | Complete onboarding form & e-sign | Candidate | Valid `onboarding_token` | Open link → fill form + photo (`Form Submitted`) → agreement auto-generated → e-sign (PDF fallback) → `Signed – Pending Approval`. |
| UC-02 | Approve candidate → Active associate | Accounts / Admin | Candidate `Signed – Pending Approval` | Review submission + signed agreement → Approve → convert to associate (`EN####`, Approved+Active) → login provisioned → signed agreement filed into P-file; or Reject (`onboarding_stage = Rejected`). |
| UC-03 | First-login photo capture | Consultant (new associate) | Associate Approved+Active | Log in first time → forced photo capture → `photo_file_key` stored → access granted. |
| UC-04 | Maintain associate master & hierarchy | Accounts / Admin | Associate exists | Edit details → set uplines (2nd auto-derived) → cycle/missing-upline rejected → audit-logged. |
| UC-05 | Export contacts | Admin | Associates exist | Run export → CSV of Approved + Active/Terminated associates. |
| UC-06 | Submit a sale with multiple products + add-ons | Consultant / SM / SD | Closer Approved+Active; products active | Enter header → add one or more line items (company + product + line amount) → tick per-line add-ons → choose plan → submission `Submitted` (commission later computed per line). |
| UC-07 | Verify sale → transaction | Accounts / Admin | Submission `Submitted` | Verify → `transaction_code` assigned → upline snapshot + structure version resolved → eligibility computed. |
| UC-08 | Configure commission structure (incl. Commission Type) | Admin (Product Owner) | — | Add/edit product: choose `commission_type ∈ {Percentage, Fixed}` + matching rate field, set Company Cut/overrides, com codes, upgrades, internal/external flag → versioned by effective date. |
| UC-09 | Issue invoice (multi-company, 2 types) | Accounts / owning salesperson | Verified transaction | Group line items by Company Entity → one invoice per entity (single-entity = one invoice) → unique number per company + type → branded PDF (computer-generated footer or signature path). |
| UC-10 | Auto-generate installment schedule | Consultant / Accounts | Installment plan keyed | Enter total + deposit + count → schedule + per-installment invoices auto-generated, summing to total. |
| UC-11 | Mark invoice/installment paid | Accounts / Admin | Outstanding invoice exists | Open Outstanding tab → Mark as Paid → status Paid + paid_date → eligibility recomputed. |
| UC-12 | Adjust installment plan | Accounts / Admin | Plan active, some paid | Edit remaining terms → paid history preserved → remaining schedule recomputed. |
| UC-13 | Run commission engine | Admin / Accounts | Verified transactions exist | Run engine → ledger lines (personal/override/add-on/retained/external) → reconciles; idempotent. |
| UC-14 | Manual commission override | Admin | Transaction exists | Key manual amount + reason → supersedes computed → flagged + audit-logged. |
| UC-15 | Build monthly payout + bank file | Accounts / Admin | Eligible ledger lines | Aggregate per associate per month → statements → generate GIRO/CSV bank file batch. |
| UC-16 | Payout status workflow | Accounts / Admin | Payout built | Pending → Approved → Paid (locks row, stamps date); Cancelled terminal. |
| UC-17 | View scoped dashboard | Consultant / SM / SD / Admin | Logged in | Open dashboard → data scoped to self/downline/global → tiles reconcile with ledger. |
| UC-18 | Post & read notices | Accounts/Admin; all associates | — | Admin posts notice → in-app + email → renders in home feed for targeted associates. |
| UC-19 | Access documents & P-file (My Agreement) | All associates | Documents exist | Open repository → view/download templates and own P-file (signed agreement + HR docs); managers do not see downline P-files. |
| UC-20 | Register & browse vendor referrals | All associates (submit); all (view) | — | Submit registration + agreement → timestamped first-claim → all browse view-only. |
| UC-21 | Upload & download sales agreements | Admin/Accounts (upload); targeted associates (download) | Document assignable | Admin uploads Vendor MOU / Sales Agreement → assign to All/Team/Associate → targeted associates download from Sales Agreements tab (download-only). |
| UC-22 | View & download digital name card / VCF | All users (own); Admin (any) | Profile exists | Open My Name Card → card auto-populated from profile + company entity → download `.vcf` and rendered image/PDF; updates when profile changes. |

---

## 6. Assumptions & Constraints

### 6.1 Singapore / regulatory
- **NRIC** is collected and stored **encrypted and masked**; access restricted to `Admin`/`Accounts` (PDPA).
- **PayNow** and **Bank Transfer** are the supported payout methods (`payment_method` enum).
- **PDPA:** Singapore data residency (ap-southeast-1), consent captured at recruitment, PII encryption and access logging.
- **GIRO:** the monthly payout produces a **bank bulk-payout (GIRO) file** for associate salary/commission only. The exact bank/GIRO file spec is to be confirmed (PRD §16.9).
- **GST:** not active (revenue < S$1M). Math is **GST-ready** (toggle + rate) but **default off**.

### 6.2 Product / business
- **Multi-brand invoicing:** invoices are issued under the three company entities — **Enshrine Services Pte Ltd**, **Enshrine Pets Paradise Pte Ltd**, **Enshrine Afterlife Planner Pte Ltd**; the per-entity invoice prefixes are to be confirmed (PRD §16.10/§16.13).
- **No payment gateway in v1:** all payments recorded manually via Mark-as-Paid.
- **Installment commission gating:** default milestone is the **3rd installment paid** (configurable; recognition default = all-or-nothing at threshold) (PRD §16.3).
- **External products** (columbarium/niche/memorial): exact Enshrine retained-cut % and whether any associate commission applies are to be confirmed (PRD §16.12).
- **Override chain depth:** default depth 2 (direct + 2nd upline) (PRD §16.4).
- **Add-on basis/attribution:** default = % of sale, attributed to closer (PRD §16.1–§16.2).
- **Company Retained %:** derived by default (PRD §16.5).
- **Payout timing:** monthly batch **plus** ad-hoc ("money-fall") run (PRD §16.6).
- **Invoice mode:** per-company-type by default, consolidated optional; merge-invoices is a later phase (PRD §16.7).
- **E-sign:** in-house canvas signature for v1; customer-facing remote e-sign timing TBD; PDF-download-to-sign path always available (PRD §16.8).

### 6.3 Technical
- Stack: Next.js (App Router) + React + TypeScript + Tailwind/shadcn, PostgreSQL + Prisma, object storage with signed URLs, server-side PDF generation, queued/scheduled jobs.
- Money is `NUMERIC(14,2)` SGD; soft-delete via `archived_at`; UUID IDs; audit logging on privileged actions.

### 6.4 Deferred (Won't-have-v1)
Payment-gateway integration (N-1); AI festive/DM image generator (M-2, static templates only); full Vendor/Supplier/Logistics LMS (L-3).

---

## 7. Traceability — Epics ↔ PRD Sections

| Epic | Theme | PRD section(s) | Key entities |
|---|---|---|---|
| A | Candidate Onboarding & E-Sign (admin-initiated) | §6.1, §6.1.2 | `candidates`, `associates`, `users`, `p_files`/`pfile_documents`, `documents` |
| B | Associate Master / HR (incl. P-files) | §6.2, §6.2.1, §6.9 (Contacts), §10 | `associates`, `p_files`, `pfile_documents` |
| C | Sales Submission (multi-product line items, add-on com codes) | §6.3 | `sales_submissions`, `sale_line_items`, `products`, `com_codes` |
| D | Sales Verification & Transactions | §6.4, §8.3 | `sales_transactions`, `sale_line_items` |
| E | Commission Structure (incl. Commission Type {Percentage, Fixed}) | §6.5, §8.1, §8.4, §8.5 | `products` (`commission_type`, `closing_comm_fixed`), `com_codes`, `commission_structure_versions` |
| F | Invoicing & Installments (per-entity grouping) | §6.5b | `companies`, `invoices`, `installment_plans`, `installment_schedule` |
| G | Auto Commission Engine (per-line, Fixed branch) | §6.6, §8.1–§8.6 | `commission_ledger` (per `line_item_id`) |
| H | Monthly Payout + Bank GIRO File | §6.8 | `monthly_payouts`, `bank_file_batches` |
| I | Dashboards | §6.9, §10 (scoping) | dashboards over `commission_ledger`, `sales_transactions` |
| J | Notices | §6.10 | `notices`, `notice_reads` |
| K | Documents & Agreements (incl. Sales Agreements tab) | §6.11 | `documents`, `p_files`/`pfile_documents` |
| L | Vendor Referral Registry | §6.13 | `vendor_referrals` |
| M | Festive / DM Generator | §6.12 | (templates; `photo_file_key`) |
| N | Cross-cutting (payments, security, audit, GST) | §1.3, §4, §5, §6.5/§6.5b (GST), §9, §10 | `audit_log` |
| O | Digital Name Card / VCF | §6.14 | `name_cards` (derived from `associates`/`users` + `companies`) |

**RBAC traceability:** all role names, the permission matrix, and the downline-closure scoping in §2/§4 of this URD map directly to `05_RBAC.md` §1–§3; the gating overlay (Approved+Active) maps to `05_RBAC.md` §2 and PRD §6.1.

---

*End of URD v1.2 (source: PRD v1.5 — adds product Commission Type {Percentage, Fixed} with the shared override split, multi-product sales with per-line commission, and per-company-entity invoicing for multi-entity sales).*
