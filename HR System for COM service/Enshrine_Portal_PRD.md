# Enshrine Associate Management System — Product Requirements Document (PRD)

**Product:** Enshrine Associate Management Portal — a CRM + HRMS **"virtual office"**
**Version:** 1.5 (adds mobile-first responsive requirement §10.1; builds on v1.4 Commission Type + multi-product sales)
**Owner:** Samuel (builder, RMA / Vorkhive) for Enshrine. Vincent owns the related (vendor-side) CRM; Bincer & Silvia handle niche/columbarium economics.
**Date:** 27 June 2026
**Target builder:** Codex (autonomous code generation)
**Region context:** Singapore (NRIC, PayNow, PDPA, GIRO, GST when applicable)

---

## 0. How to use this document

This PRD is written to be handed to Codex to build a working web application. It is prescriptive: it defines the tech stack, data model, business logic, role-based access, screen-by-screen requirements, and acceptance criteria. Where a real decision is still open, it is marked **[DECISION NEEDED]** — implement the recommended default and leave a clearly commented seam so the alternative can be swapped in.

**Sources reconciled in this version**
1. **"Enshrine Management Portal.pdf"** — the 8-module pipeline design deck.
2. **"Enshrine Associate Management System.xlsx"** — the existing Google Sheets + Forms prototype (HR layer populated; downstream sheets empty).
3. **"MicrosoftTeams-video-transcript.txt"** — ~71-minute walkthrough between Samuel and the client. This added the entire invoicing, installment-driven commission, add-on commission ("com code"), notices, documents repository, e-sign onboarding, vendor-referral registry, and bank-payout-file requirements.
4. **"MicrosoftTeams-video-translation-EN.txt"** + **"Meeting-Minutes-Enshrine-Portal.md"** — a clean English translation and structured minutes that confirm (3) and add: external/columbarium product commission treatment, a manual commission-override fallback, named company brands, product categories, and the relative priority of the vendor/logistics system.

> **Change log v1.0 → v1.1:** added §6.1 e-sign onboarding + first-login photo; expanded §6.5 with com-codes/add-ons and product upgrades; added §6.5b Invoicing & Installments; expanded §6.6/§8 commission engine for installment-triggered eligibility and manual payment; added §6.10 Notices, §6.11 Documents & Agreements, §6.12 Festive/DM generator (deferred), §6.13 Vendor Referral Registry; added §6.8 bank bulk-payout file; added multi-company entities; new schema tables (§7); revised phases (§13) and open items (§16).
>
> **Change log v1.4 → v1.5:** added a **mobile-first responsive design requirement** (§10.1) — every page usable at **375px / 768px / 1280px**, no horizontal overflow at 375px, hamburger nav, single-column stacking, ≥44px tap targets, contained tables/images; Tailwind `sm:/md:/lg:` mobile-first, desktop layout preserved. Mirrored in `11_Coding_Standards.md` and `TESTING.md`.
>
> **Change log v1.3 → v1.4:** (1) **Commission Type** is now a functional product field — `Percentage` (closing commission = sale × closing_comm_%) or **`Fixed`** (a flat `closing_comm_fixed` amount per product); **both types use the same company-cut pool + ASM/SM/SD override split** (§6.5, §8.1). (2) A sale form can now contain **multiple product line items** — each line references its own product, sale amount, com codes, and structure version, and the engine computes commission **per line** (§6.3/§6.4/§8.1). New `sale_line_items` entity; `commission_ledger` lines reference a line item; products gain `commission_type` + `closing_comm_fixed` (§7, DB doc). A multi-product sale may span company entities → one invoice per company by default (§6.5b).
>
> **Change log v1.2 → v1.3:** reworked §6.1 into an **admin-initiated candidate onboarding flow** (Invited → Form Submitted → Signed–Pending Approval → Approved/Rejected) with a Candidates page and email-driven onboarding form; added **§6.2.1 P-File** (personnel file) at the **user** level for all users (forward-compatible with future permanent-staff logins); added a per-associate **Sales Agreements download tab** (admin-uploaded vendor MOUs / sales agreements) to §6.11; added **§6.14 Digital Name Card / VCF** (downloadable vCard + rendered card); replaced placeholder brands with the **real three company entities** (Enshrine Services / Pets Paradise / Afterlife Planner Pte Ltd) and added the services taxonomy + shared brand details (§6.5b, §17). New schema entities (candidates, p_files/pfile_documents, assigned documents) — see §7 / DB doc.
>
> **Change log v1.1 → v1.2 (from meeting minutes):** added **external-product commission treatment** (niche/columbarium/memorial — company retains only a small maintenance cut, bulk flows to the external provider/"Shifu") to §6.5 and §8.5; added an explicit **manual commission-override** fallback for complex funeral/cascade/upgrade cases (§6.5/§8.6); named **company brands** (Enshrine, Trust Pets) and **product categories** (Cremation, Religious Rites, Columbarium, Sea Scattering, plus funeral, pet aftercare, niche/memorial, temple/festive) (§6.5, §17); noted the **vendor/logistics system is considered higher-priority than the commission engine** (§1.3, §13); added context refs (Xero-type accounting; website enshrinepets.com.sg).

---

## 1. Product overview

### 1.1 What it is
Enshrine is a single-tenant **CRM + HRMS "virtual office"** for a Singapore funeral-services and pet-aftercare business (public site: enshrinepets.com.sg). It invoices under **three company entities: Enshrine Services Pte Ltd, Enshrine Pets Paradise Pte Ltd, Enshrine Afterlife Planner Pte Ltd**. Associates (commission-based salespeople) sell packages across product lines/categories — **Cremation, Religious Rites, Columbarium (niche), Sea Scattering, funeral services/packages, pet aftercare ("pet afterlife"), niche/memorial, temple/festive events** — and the system runs their full lifecycle and earnings, end-to-end, online, with no need to visit a physical office ("one click, they can check everything"). An accounting tool (Xero-type) is already used for invoices externally; this portal generates its own invoices.

Pipeline (from the deck, now extended):
**Recruitment + e-sign onboarding → HR master record → Sales submission (with add-on com codes) → Approval/verification → Clean sales transactions + Invoicing → Commission structure (per-product + add-ons) → Auto commission engine (installment-aware) → Monthly payout + bank payout file → Manager/Director/Personal dashboards.** Supporting features: notices, documents/agreements repository, vendor-referral registry, (later) festive marketing generator.

### 1.2 Goals
- Replace fragile spreadsheet formulas and **painful one-by-one bank transfers** with an auditable, automated engine + a **bank bulk-payout (GIRO) file**.
- Be a true **virtual office**: associates self-serve everything from one login.
- Give each Sales Manager / Sales Director a dashboard scoped to **their own downline only**, plus a personal dashboard for every associate.
- Auto-generate **invoices** (multi-company) and handle **installment plans** that gate commission payout.
- Enforce that only **Approved + Active** associates flow into sales, payouts, contacts, and dashboards.

### 1.3 Non-goals / out of scope (v1)
- **Payment gateway integration** (Stripe/HitPay/RedDot) — deferred; gateways cost ~2–3%. v1 records payments **manually**. Re-evaluate when volume/investor justifies it.
- **Festive / AI DM marketing generator** — specced (§6.12) but **deferred** (needs paid AI image service). v1 ships static templates only.
- **Vendor / Supplier / Logistics Management System (LMS)** — a *separate future product* (WhatsApp/email audit trail, backup-supplier routing, vendor payments). v1 includes only a **view-only Vendor Referral Registry** (§6.13). **Note:** the client considers this vendor/logistics system **arguably higher-priority than the commission engine**; it is out of scope for *this* portal but should be scoped next (§13, Phase 5+).
- **Vendor/supplier payments** — handled by the future LMS / a different bank function; the HR system's payout file is for **associate salary/commission GIRO only**.
- **Public marketing website** (services site, packages, contact-us, chatbot, carousel) — a separate deliverable, not this app.
- **GST handling** — not active (revenue < SGD 1M). Build the invoice/commission math **GST-ready** (toggle + rate) but default off.

---

## 2. Roles & personas

Organisation hierarchy (by `designation`, lowest → highest rank):

| Rank code | Designation | Notes |
|---|---|---|
| `CONSULTANT` | Sales Consultant | Front-line closer. |
| `ASM` | Assistant Sales Manager | First override tier. |
| `SM` | Sales Manager | Override tier. |
| `SD` | Sales Director | Top of a division. |

> Override rates ASM/SM/SD apply to the **upline** receiving the override, based on that upline's designation.

### 2.1 Application roles (RBAC)
| Role | Who | Capability summary |
|---|---|---|
| **Admin / Product Owner** | Samuel / Enshrine ops | Full access: approve associates, manage companies, products, com codes, commission rates; verify/approve sales; run engine; manage invoices, payouts, notices, documents. The "product owner" login that creates products & com codes. |
| **Accounts / HR Verifier** | Ops staff | Verify/approve submitted sales before commission flows; key in HR detail; manage payouts. (May be the same person as Admin in v1.) |
| **Sales Director** | SD associates | Self-service virtual office; dashboard scoped to full downline; submit sales; generate invoices; view own + downline commissions/payouts. |
| **Sales Manager** | SM associates | As SD, scoped to own (smaller) downline. |
| **Sales Consultant** | Consultant associates | Submit own sales, generate invoices, view own commissions/payouts and personal dashboard only. |

**Scoping rule:** a manager/director sees an associate iff that associate is in their **downline closure** (recursive `direct_upline_id`). Admin sees all. A consultant sees only themselves.

---

## 3. Glossary

- **NRIC / PayNow / PDPA / GIRO** — Singapore identity number; instant payment keyed to mobile; data-protection law; bank bulk-transfer file format for payroll.
- **Upline / Downline** — associates above / recursively below a given associate.
- **Closing Commission** — `sale_amount × closing_comm_pct`, total commission a sale generates.
- **Company Cut Pool ("company card")** — slice the company takes before override distribution = `closing_commission × company_cut_pct`. Overrides are paid **out of this pool**, so they do **not** reduce the closer's commission.
- **Override** — slice of the pool paid up the upline chain based on the upline's rank.
- **Company Retained** — pool remainder after overrides.
- **Net Closing Commission Payable** — what the closer keeps = `closing_commission − company_cut_pool`.
- **Com Code / Add-on commission** — an extra commission component attached to a product (percentage of overall, or absolute $), ticked by the salesperson at submission (e.g. scattering, remembrance add-ons). Requires verification before paying.
- **Installment plan** — total split into N payments + deposit; commission becomes payable on a configured installment milestone (default: 3rd installment).
- **Eligibility** — whether a transaction's commission may be paid (gated by approval, active status, verification, and installment milestone).
- **Company entity** — one of several legal/brand stamps used to issue invoices.

---

## 4. System architecture & tech stack

**[DECISION NEEDED — default chosen]** Recommended stack:

- **Frontend:** Next.js 14+ (App Router) + React + TypeScript + Tailwind + shadcn/ui.
- **Backend:** Next.js server actions / route handlers (or thin Node/Express API).
- **Database:** PostgreSQL + **Prisma**.
- **Auth:** email/password + role claims via NextAuth (Auth.js) or Supabase Auth; secure HTTP-only cookie sessions.
- **File storage:** S3-compatible (S3 / Supabase Storage / R2) for agreements, invoices, signed docs; store keys only, serve via signed URLs.
- **E-signature:** in-app signature capture (canvas/tablet) producing a signed PDF; **[DECISION NEEDED]** build in-house vs integrate a provider — default = in-house canvas sign for v1.
- **PDF generation:** server-side (`@react-pdf/renderer` or Puppeteer) for invoices, payout statements, agreements.
- **Background jobs:** queued/scheduled runner for commission runs and payout/bank-file generation.
- **Hosting:** Vercel + managed Postgres (Supabase / Neon / RDS), **ap-southeast-1 (Singapore)** for data residency.

**Cross-cutting**
- Money as `NUMERIC(14,2)` (or integer cents), currency **SGD**; never floats.
- Every table: `id` (UUID), `created_at`, `updated_at`, and where mutable `created_by` / `updated_by`.
- **Soft-delete** via `archived_at` (mirrors the Archive sheet); no hard deletes.
- **Audit log** for approvals, verifications, commission runs, rate changes, invoice paid-marking, payout status changes.

---

## 5. Roles & permissions matrix

| Action | Admin | Accts/HR | SD | SM | Consultant |
|---|---|---|---|---|---|
| Approve/reject associates; manage HR detail | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage companies, products, com codes, rates | ✅ | ❌ | ❌ | ❌ | ❌ |
| Submit a sale (with add-ons) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Verify/approve a submitted sale | ✅ | ✅ | ❌ | ❌ | ❌ |
| Generate / manage invoices, mark paid | ✅ | ✅ | own sales | own sales | own sales |
| Run commission engine | ✅ | ✅ | ❌ | ❌ | ❌ |
| View commission ledger | all | all | downline | downline | self |
| Manage payouts; generate bank file | ✅ | ✅ | ❌ | ❌ | ❌ |
| View payout status | all | all | downline+self | downline+self | self |
| Post notices | ✅ | ✅ | ❌ | ❌ | ❌ |
| View notices / documents | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage vendor referral registry | ✅ | ✅ | view | view | view |
| Dashboards | global | global | own team | own team | self |
| Manage users / roles | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 6. Module specifications

### 6.1 Candidate onboarding + e-sign → Associate Master
**Purpose:** recruit associates through an **admin-initiated candidate flow** and open their virtual office with minimal friction. This is the primary intake path (the self-serve recruitment form is an alternative entry point).

#### 6.1.1 Candidate lifecycle (admin-initiated)
A **candidate** is a pre-associate record. There is a dedicated **Candidates page** in the Admin/HR area.

1. **Admin enters basic info** for a new candidate — at minimum **full name, mobile number, email** (optionally designation, intended upline/team). This creates a `candidate` with `onboarding_stage = Invited`.
2. **System emails the candidate** a secure, tokenised link to the **Onboarding Form** (self-service, no login required yet).
3. **Candidate fills the Onboarding Form** — the full associate detail set (§7.1: NRIC, DOB, address, bank/PayNow, etc.) plus a profile **photo**. On submit → `onboarding_stage = Form Submitted`.
4. **System auto-generates the Associate Agreement** from a template populated with the candidate's submitted details.
5. **Candidate e-signs** the agreement online (in-app signature; **PDF-download → sign → re-upload fallback** for those who can't e-sign). On signing → `onboarding_stage = Signed – Pending Approval`. **At this point the candidate is considered "signed, awaiting admin approval."**
6. **Admin/HR reviews** the submission + signed agreement and **approves or rejects**. On **Approve**: the candidate is **converted to an `associate`** (auto ID `EN####`), `approval_status = Approved`, `associate_status = Active`, the **virtual office login is provisioned**, and the company-counter-signed agreement is filed in the associate's **P-file** (§6.2.1). On **Reject**: `onboarding_stage = Rejected` with a reason.
7. **First login** confirms/forces the **profile photo** (used by the name card §6.14 and the festive/DM generator §6.12) and prompts a password set.

```
Invited → Form Submitted → Signed – Pending Approval → (Approve) → Active Associate
                                                       → (Reject) → Rejected
```

> **Alternative entry:** a public **Recruitment Form** can create a candidate at `Form Submitted` directly (skipping the admin-invite step); the rest of the flow is identical.

#### 6.1.2 Status enums
- `onboarding_stage ∈ {Invited, Form Submitted, Signed – Pending Approval, Approved, Rejected}` (candidate lifecycle)
- `approval_status ∈ {Pending, Approved, Rejected, Incomplete}` (associate, post-conversion)
- `associate_status ∈ {Active, Suspended, Terminated, Inactive}`

**Gating rule (critical):** only `Approved` + `Active` associates are eligible to be a closer, receive commission/payout, appear in Contacts export, or appear in manager dashboards. Candidates (not yet approved) cannot log in to the virtual office beyond the onboarding form, and never appear downstream.

**Hierarchy integrity:** set Direct Upline ID, 2nd Upline ID (default **auto-derive** = direct upline's direct upline, with manual override), Recruiting Manager, Team/Division, Designation, payment details. Prevent cycles; uplines must exist (or be null/`-` for division heads).

**Acceptance criteria**
- Admin can create a candidate with just name + mobile + email → candidate at `Invited`, and an onboarding email is sent.
- Completing the onboarding form auto-generates an agreement awaiting e-sign; signing moves the candidate to `Signed – Pending Approval`.
- Approving converts the candidate to an `Active` associate with the next `EN####`, provisions login, and files the signed agreement in the P-file.
- A candidate cannot be selected as a closer or appear in any payout/dashboard.
- First login cannot complete without a confirmed photo.
- Cyclic upline assignment is rejected.

### 6.2 Associate Master / HR System
The master people record (see §7.1). Admin maintains hierarchy, approval/active status, payment details, remarks. Status changes have side effects: Terminated/Suspended stop **future** commission eligibility but **retain history**. Provides the **Contacts Export** (§6.9). All edits audit-logged.

#### 6.2.1 P-File (personnel file) — for **all users**
Every user has a **P-file**: a per-person document store holding their HR/personnel documents — the **signed Associate Agreement** (company-counter-signed copy), onboarding submission, ID/agreement uploads, and any HR documents the Admin files for them.

- The P-file is created at candidate→associate conversion (the signed agreement is filed automatically) and persists for the life of the record.
- **Forward-compatibility:** the P-file is modelled at the **user** level, not just the associate level, so that **permanent (non-commission) staff** can have logins and P-files in a future phase without rework. (Permanent-staff payroll/roles are out of scope for v1 — see §1.3 — but the data model accommodates them.)
- Access: the owner can **view/download their own** P-file documents; Admin/Accounts/HR manage all P-files; managers do **not** see downline P-files by default (HR-sensitive). NRIC/bank remain masked per §10.
- Audit: filing/removing P-file documents is audit-logged.

### 6.3 Sales Submission (with add-on com codes)
**Purpose:** let any associate submit a sale from their virtual office.

**Header fields:** Sales Date, Client Name, Client Contact, Payment Type, **Full Payment / Installment** (+ deposit + #installments if installment), Amount Collected, Closing Associate (defaults to self; must be Approved+Active), Invoice/Agreement upload, Remarks. **Sale Amount (total)** = sum of the line items below.

**Line items (one or more) — a sale can include multiple products:** each line item captures:
- **Product Code** (lookup of an active product) → Product Name, Commission Type, rates auto-resolved (not free-typed).
- **Company Entity** for that line (which entity bills it; defaults from the product) — *different products may bill under different entities*.
- **Line Sale Amount** (and optional quantity).
- **Add-on com codes ticked** for that product (e.g. scattering, remembrance — §6.5).
- Optional **upgrade** reference (parent product / cascade).

**Behaviour**
- Each line resolves its own product rates and **commission is computed per line** (§8.1); the sale's commission = sum of all lines.
- Salesperson **ticks applicable add-ons per line** at submission; these add to commission once verified.
- Creates a **pending submission**; not yet official. It must pass **Accounts/HR verification** (§6.4) before becoming a transaction and before any commission flows.

**Acceptance criteria**
- A sale with two+ products produces a line item per product, each with its own resolved rates.
- Submission with an ineligible closer or any inactive product/add-on is rejected.
- `Amount Collected ≤ total Sale Amount`; installment params validated; total = sum of line amounts.

### 6.4 Sales Transactions (verified official record) + verification
**Purpose:** the authoritative, deduplicated record of confirmed sales — created when Accounts/HR **verifies/approves** a submission.

**Header fields:** Transaction ID, Sales Date, Client Name, Client Contact, Sale Amount (total), Payment Mode, Full Payment/Installment, Amount Collected, Closing Associate ID/Name, **Direct Upline ID + 2nd Upline ID (snapshot at verification)**, Commission Eligibility, Agreement Upload, Invoice Number(s), Remarks.

**Per line item (carried from submission):** Company Entity, Product Code/Name, **Commission Type**, Line Sale Amount, **Add-on com codes (verified)**, **Structure Version (resolved per line)**.

**Behaviour**
- On verification: assign unique **Transaction ID**, **snapshot the upline chain** (so later hierarchy/rate edits don't rewrite history), resolve each **line's structure version** by Sales Date, and compute **Commission Eligibility** (§8.3).
- Commission is computed **per line item** and summed (§8.1).
- **Invoicing:** lines are grouped **by Company Entity** → one invoice per entity by default (a single-entity sale yields one invoice); consolidated invoicing is the alternative (§6.5b).
- Commission only flows to dashboards **after** verification/approval.
- Invoicing (§6.5b) is driven from the transaction.

**Acceptance criteria**
- Verification creates an immutable upline snapshot + unique ID.
- No commission appears on any dashboard for an unverified submission.
- Eligibility auto-updates as collections are recorded.

### 6.5 Commission Structure (products, overrides, add-on com codes, upgrades)
**Purpose:** per-product commission rules. (Prototype sheet is header-only with a duplicated column — rebuild per below.) Managed by the **Admin/Product Owner** login.

**Per-product fields:** Product Code, Product Name, Product Category (e.g. Funeral, Pet Aftercare, Niche, Temple/Festive), **Commission Type**, **Closing Comm %**, **Closing Comm Fixed ($)**, **Company Cut % ("company card")**, **ASM Override %**, **SM Override %**, **SD Override %**, **Company Retained %** (default derived = `100 − overrides` of the pool), Active Status, **Effective Date**, Remarks.

**Commission Type (drives the closing-commission basis):** `commission_type ∈ {Percentage, Fixed}`.
- **Percentage** — closing commission = `sale_amount × closing_comm_pct` (uses Closing Comm %; Closing Comm Fixed ignored).
- **Fixed** — closing commission = `closing_comm_fixed` (a flat $ amount for the product, independent of sale amount; Closing Comm % ignored).
- **Either way, the same downstream split applies:** company-cut pool = `closing_commission × company_cut_pct`, then ASM/SM/SD overrides are drawn from that pool and the remainder is Company Retained (§8.1). A product must define the field matching its type (validate: Percentage needs `closing_comm_pct`; Fixed needs `closing_comm_fixed`).

**Add-on commission codes ("com codes"):** each product can have zero or more add-ons:
- `com_code`, label, value type (`Percentage of overall` | `Absolute amount`), value (e.g. `2%`, `$20`, `$0.28`), active flag.
- Ticked by the salesperson at submission; added to commission after verification.

**Product upgrades / cascades:** a base product (e.g. "Funeral System" base 1.5%) can have **upgrade/add-on products** (e.g. sender package, source-funeral add-on), each carrying its **own commission**. Model upgrades as related products/lines so each upgrade's commission is computed and attributed correctly.

**Internal vs external products:** flag each product as **Internal** or **External**.
- *Internal* products (e.g. own funeral/pet packages) use the full pool model above.
- *External* products (e.g. **columbarium niche, memorial placements** created by an external provider / "Shifu") are mostly paid out to the external provider; **Enshrine retains only a small cut** (for building maintenance / admin maintenance). Model this with an `external_company_retained` (small %) and route the bulk to the external provider rather than the override pool. Exact rates to be supplied by the client / Vincent (§16).

**Manual commission override (fallback):** for complex funeral/cascade/upgrade or external cases the engine can't fully model, allow an Admin to **manually key in the override/commission amount** per upline on a transaction. The manual value overrides the computed one and is audit-logged with a reason. This is the explicit "worst-case" path the client described.

**Rules**
- Override percentages are **% of the Company Cut Pool**, not of the sale.
- Validation: `ASM% + SM% + SD% + Company Retained% = 100%` of the pool (Company Retained derived by default).
- **Versioned by Effective Date:** editing a rate (e.g. direct upline 2% → 1.5%) creates a new version effective from a date; transactions use the version active on their Sales Date — historical payouts never change. Admin can apply "from this date onwards, everyone's rate becomes X."
- Only `Active` products/add-ons are selectable at submission.
- **GST-ready, default off:** invoice/commission math supports a GST toggle + rate; not applied until enabled.

**Acceptance criteria**
- Adding overrides exceeding 100% of the pool is rejected.
- Changing a rate from a date does not alter prior transactions.
- A ticked add-on (percentage or absolute) is correctly added to commission after verification.

### 6.5b Invoicing & Installments
**Purpose:** generate invoices from transactions, across multiple company entities, and manage installment plans that gate commission.

**Company entities (multi-company):** maintain N company entities, each with its own name, logo/stamp, address, and **invoice number sequence**. The known legal entities are:
- **Enshrine Services Pte Ltd** (funeral services)
- **Enshrine Pets Paradise Pte Ltd** (pet funeral & aftercare)
- **Enshrine Afterlife Planner Pte Ltd** (pre-planning / afterlife planning)

Shared brand details (for invoices/name cards): address **74 Lorong 6 Geylang, Singapore 399226**; web **enshrine.sg**; tagline **"Farewell with Grace, Care with Devotion / 以欣慰送别，以奉敬传爱"**. **Each sale line item carries its own Company Entity**, so a multi-product sale may span entities — invoices are **grouped by Company Entity**: one invoice per entity (a single-entity sale = one invoice) by default, or **consolidated** (one invoice spanning entities) — **[DECISION NEEDED]**, default = per-entity, with a consolidate option.

**Invoice types**
1. **Computer-generated (no signature):** receipt-style, footer "This is a computer-generated invoice; no signature required." Auto invoice number `INV-<COMPANY>-YYYY-#####`.
2. **Signature / agreement invoice:** requires customer signature — download PDF → sign on iPad → send back; **or** (later) in-app e-sign link sent to the customer who signs and returns digitally. (Digital-sign caveat noted for elderly customers; keep PDF-download path always available.)

**Outstanding invoices tab:** lists all unpaid invoices with a **"Mark as Paid"** button. Marking paid flips the invoice (and, for installments, the relevant installment) to **Paid** and feeds eligibility. If not marked paid, the invoice remains outstanding/awaiting signature.

**Installments**
- Salesperson keys **total amount, number of installments, deposit**; system **auto-calculates** the balance and **pre-generates the installment schedule + an invoice per installment**. Formula (no GST): `installment = round((total − deposit) / n)` with residual handling on the final installment.
- **Manual payment recording (no gateway in v1):** when a customer pays an installment, Accounts marks that installment's invoice Paid → the engine recomputes eligibility; commission "jumps" to payable once the milestone is hit (§8.3).
- **Adjustable installments (renegotiation):** allow editing a plan mid-way (e.g. spread 300/300/300/100 → 600/600/400 or recalc remaining balance over new terms). Implement via an **adjustable amount / sub-category** on the plan; previously-paid amounts are preserved and only the remaining schedule recomputes.
- **Merge invoices** helper **[DECISION NEEDED / nice-to-have]:** ability to merge two invoice numbers into one. Default = provide a simple "close & re-issue/inverse" path in v1; full merge in a later phase.

**Acceptance criteria**
- Issuing an invoice produces a unique number in the chosen company's sequence and a correct PDF with that company's stamp.
- Keying total + n + deposit auto-generates a schedule whose installments sum to the total.
- Marking an installment Paid updates eligibility and the commission engine idempotently.
- Editing a plan preserves paid history and only recomputes the remaining schedule.

### 6.6 Auto Commission Engine (installment-aware)
**Purpose:** compute, per verified+eligible transaction, the closing commission, pool, overrides up the chain, company retained, **add-on commissions**, and per-associate payable lines → writes the **Commission Ledger**. Idempotent and re-runnable (safe after each installment payment or rate change). Algorithm in §8.

**Acceptance criteria**
- The deck's worked example (§8.2) yields exactly: closer $600, SM override $80, SD override $40, retained $280.
- Add-on com codes (percentage/absolute) are added correctly.
- Commission becomes payable only when eligibility milestone is met (default 3rd installment, §8.3).
- Re-running produces no duplicate ledger lines; rate changes never rewrite historical transactions.

### 6.7 Commission Ledger
Line-item record of every entitlement. One transaction → closer personal line + override line(s) + add-on line(s) + company-retained line. Fields: Ledger ID, Transaction ID, Payout Month, Associate ID/Name, Designation, Line Type (`Personal` | `Override` | `Add-on` | `Company Retained`), Basis Amount, Rate/Value, Amount, Eligibility, Status, Remarks. **Reconciliation:** personal + overrides + add-ons + retained ties exactly to total commission (no rounding leakage).

### 6.8 Monthly Payout + bank bulk-payout file
**Purpose:** summarise what each associate receives, with a status workflow and a **bank GIRO bulk-upload file** to end one-by-one transfers.

**Fields:** Payout Month, Associate ID/Name, Designation, Personal Commission, Override Commission, Add-on Commission, Total Payable, Payment Method, PayNow Number, Bank Name, Bank Account Number, Payout Status, Paid Date, Statement file, Remarks.

**Payout Status:** `Pending`, `Approved`, `Paid`, `Cancelled`. (Per the walkthrough, a separate "Hold" is **dropped**; held items just stay `Pending`. Pending also covers installment-incomplete cases.)

**Behaviour**
- Aggregate eligible Commission Ledger lines per associate per Payout Month.
- Generate a **payout statement PDF** per associate per month.
- **Bank bulk-payout export:** produce a **GIRO/bank text file** (and CSV) for upload to the bank to pay all associates' salary/commission at once. **This file is for associate payout only** — vendor/supplier payments are out of scope (future LMS).
- Status workflow Pending → Approved → Paid (Paid stamps Paid Date and locks the row). Cancelled is terminal.
- **Payout timing [DECISION NEEDED]:** the client described payout as "money-fall" / triggered when used rather than strictly month-end. Default = monthly batch **plus** an ad-hoc run option, both producing the bank file.

**Acceptance criteria**
- `Total Payable = Personal + Override + Add-on` for the month; only `Eligible` lines roll in.
- Bank file matches selected payouts exactly and validates against the bank's format.
- Marking Paid locks the payout and stamps Paid Date.

### 6.9 Dashboards (Director / Manager / Personal) + Contacts Export
**Purpose:** scoped performance views.

- **Personal dashboard (every associate):** own CRM/performance, own commissions (personal/override/add-on/pending/paid), own recruitment & downline, downline split by team.
- **Manager (SM) dashboard:** own team's performance.
- **Director (SD) dashboard:** full downline.
- **Admin:** global.

**Tiles:** Monthly sales, YTD sales, Team target vs achievement, Commission earned, Override commission, Team ranking.
**Team table (per downline associate):** Sales this month, Cases closed, Cases pending, Collection status, Last sale date, Active/inactive.
**Commission view:** Personal, Override, Pending, Paid.
**Recruitment view:** New recruits, Approval status, Associate agreements, Team growth.

**Visibility [DECISION NEEDED]:** whether consultants see their own full performance now or later — default = show personal dashboard to everyone; managers can be configured to reveal/hide team-member-level detail.

**Behaviour:** all data strictly filtered to the logged-in user's downline closure (recursive CTE); cross-scope access returns 403. Targets configurable by Admin per team/associate.

**Contacts Export:** Google-Contacts-compatible CSV of associates where `approval_status = Approved` AND `associate_status ∈ {Active, Terminated}` (matches the prototype's live FILTER). Columns: Associate ID, Full Name, Designation, Email, Mobile, DOB, Status.

**Acceptance criteria**
- A manager/consultant cannot see anything outside their scope (automated permission test).
- Tiles reconcile with the ledger/transactions.

### 6.10 Notices / Notifications
**Purpose:** company-wide announcements (e.g. clause/code changes affecting associate payment) delivered in-app + email.

**Behaviour**
- Admin/HR posts a notice (title, body, optional attachment). Goes to all (or scoped) associates.
- Delivered as: in-system notification (bell + count) **and** email.
- Notices appear in the **home-page feed**; associates scroll the home/main page to re-read older notices (no separate per-user "folder" to keep storage small). Associates **download & keep** important attachments themselves.

**Acceptance criteria**
- Posting a notice notifies the targeted associates in-app and by email and renders in their home feed.

### 6.11 Documents & Agreements repository
**Purpose:** central place for agreements/templates and each associate's own documents. Surfaced to associates as tabs in their virtual office.

**Contents / tabs**
- **Company agreement templates** available to download/use: e.g. Referred (Marketing) Partnership Agreement, Cage Storage Agreement, funeral package agreements, associate agreement template, etc.
- **Sales Agreements (admin-uploaded, per-associate) — NEW tab:** a dedicated **"Sales Agreements"** tab where associates **download agreements the Admin has uploaded for them** — e.g. **MOUs for vendors** and **sales agreements with vendors**. Documents can be **assigned to a specific associate**, to a **team**, or to **all** associates. Associates have **read/download only**; Admin/Accounts upload, assign, replace, and revoke. This complements the Vendor Referral Registry (§6.13): the registry records *who claimed which vendor*; this tab distributes the *agreement files* associates need.
- **"My Agreement" / P-file (§6.2.1):** the associate's own signed Associate Agreement (company-counter-signed copy) and personnel documents, view/download by the owner.
- Storage discipline: keep essential signed agreements; encourage download-and-save for bulky/transient files to control storage.

**Acceptance criteria**
- Admin can upload a document and assign it to an associate/team/all; the targeted associate(s) see it under the **Sales Agreements** tab and can download it; non-targeted associates cannot.
- An associate can view/download relevant company agreement templates and their own signed agreement (P-file).

### 6.14 Digital Name Card / VCF
**Purpose:** give every user a downloadable, viewable **digital name card** (virtual contact card) generated from their profile — matching the Enshrine business-card style (gold ENSHRINE logo, light-blue theme, cornflower motif).

**Behaviour**
- Each user has a **"My Name Card"** tab to **view** their card and **download** it.
- The card is **auto-populated** from the user's profile: name (English + Chinese name if present), **designation/title** (e.g. *Funeral Director*), **HP** (mobile), **email**, the relevant **company entity** name, company **address** (74 Lorong 6 Geylang, Singapore 399226), **web/Facebook**, logo, and a **QR code** (encoding the vCard / a contact link). Profile photo optional.
- **Downloads:**
  - **`.vcf` (vCard 3.0/4.0)** — importable into phone/email contacts (FN, N, TITLE, ORG, TEL, EMAIL, ADR, URL, PHOTO).
  - **Image/PDF card** — a rendered card (PNG/PDF) in the Enshrine template for sharing.
- Users view/download **their own** card; Admin can view all. Card data updates automatically when the profile changes.

**Acceptance criteria**
- A user can view their name card and download both a valid `.vcf` (imports cleanly into a phone contact app) and a rendered image/PDF.
- The card reflects the user's current name, designation, mobile, email, and company entity; editing the profile updates the card.

### 6.12 Festive / DM marketing generator — **DEFERRED**
**Purpose (future):** a "Festive/Events" tab where the media team uploads DM/greeting templates; an associate adds their **name, photo, contact number** and the system **auto-generates a personalised marketing image** (AI-assisted) to download and send to customers.

**v1 scope:** ship **static templates** only — associate downloads a template and adds their own number/photo manually (no AI). Full AI generation deferred (requires a paid AI image service). First-login photo (§6.1) feeds this when enabled.

### 6.13 Vendor Referral Partnership Registry (view-only) — bridge to future LMS
**Purpose:** record and surface vendor/referral tie-ups so associates don't double-approach the same vendor.

**Behaviour**
- A **Referred (Marketing) Partnership Registration** form: when an associate signs a vendor (e.g. groomer, pet-level/distribution centre), they submit it with the agreement upload. A **timestamped record** is created — **timestamp determines first-claim** if two associates approach the same vendor.
- All associates get a **view-only directory** of registered vendors/tie-ups (they cannot edit), so they can check existing partnerships before approaching.
- **Out of scope (future LMS):** full vendor/supplier logistics — WhatsApp/email send with audit trail/call log, backup-supplier routing by preference, vendor "damage/delivery" workflows, vendor payments. Note this is a *separate* system Samuel will build; design the registry so it can later feed the LMS.

**Acceptance criteria**
- Submitting the form creates a timestamped, view-only registry entry visible to all associates; only Admin/HR can edit.

---

## 7. Data model / schema

All tables: `id uuid pk`, `created_at`, `updated_at`. Money `NUMERIC(14,2)` SGD. Enums as Postgres enums / check constraints. Soft-delete `archived_at`.

### 7.1 `associates` (Associate Master)
associate_code (`EN####`, auto), timestamp, full_name, business_name, mobile_number, email, **nric (encrypted, masked)**, date_of_birth, designation enum {Sales Consultant, Assistant Sales Manager, Sales Manager, Sales Director}, direct_upline_id fk, direct_upline_name, second_upline_id fk, second_upline_name, recruiting_manager, team_name, payment_method enum {PayNow, Bank Transfer}, paynow_number, bank_name, **bank_account_number (encrypted)**, agreement_file_key, signed_agreement_file_key, photo_file_key, join_date, remarks, approval_status enum {Pending, Approved, Rejected, Incomplete}, associate_status enum {Active, Suspended, Terminated, Inactive}, archived_at.
Linked `users`: credentials, role, optional `associate_id`. **P-file is keyed on `user_id`** (so future permanent staff also get one).

### 7.1a `candidates` (pre-associate onboarding)
full_name, mobile_number, email, intended_designation (nullable), intended_direct_upline_id (nullable), intended_team (nullable), onboarding_token, onboarding_stage enum {Invited, Form Submitted, Signed – Pending Approval, Approved, Rejected}, submitted_payload (jsonb — full onboarding form), photo_file_key, agreement_file_key, signed_agreement_file_key, invited_by fk→users, reviewed_by fk→users, reject_reason, converted_associate_id fk→associates (nullable). On Approve → creates an `associate` (+ `users` login) and files the signed agreement into the P-file.

### 7.1b `p_files` & `pfile_documents` (personnel file — all users)
`p_files`: user_id fk→users (unique), associate_id fk (nullable), notes.
`pfile_documents`: p_file_id fk, doc_type enum {Signed Associate Agreement, Onboarding Submission, ID Document, HR Document, Other}, title, file_key, filed_by fk→users, filed_at. Owner can view/download own; Admin/Accounts/HR manage all.

### 7.2 `companies` (invoice entities)
name, legal_name, logo_file_key, stamp_file_key, address, invoice_prefix, invoice_next_seq, gst_registered (bool, default false), gst_rate, active.

### 7.3 `products` / `commission_structures` (versioned)
product_code, product_name, product_category, **commission_type enum {Percentage, Fixed}**, closing_comm_pct (used when Percentage), **closing_comm_fixed numeric (used when Fixed)**, company_cut_pct, asm_override_pct, sm_override_pct, sd_override_pct, company_retained_pct (derived), **is_external (bool)**, **external_company_retained_pct** (small cut Enshrine keeps on external products), default_company_id fk (nullable — default billing entity), active_status, effective_date, parent_product_id (for upgrades/cascades, nullable), remarks. Unique (product_code, effective_date). Check: Percentage ⇒ closing_comm_pct set; Fixed ⇒ closing_comm_fixed set.

### 7.4 `com_codes` (product add-ons)
product_id fk, com_code, label, value_type enum {Percentage, Absolute}, value, active.

### 7.5 `sales_submissions` (header)
sales_date, client_name, client_contact, sale_amount (total = Σ line items), payment_type, payment_plan enum {Full Payment, Installment}, deposit, installment_count, amount_collected, closing_associate_id fk, invoice_file_key, remarks, status enum {Submitted, Verified, Rejected}. *(Products moved to line items, §7.5a.)*

### 7.5a `sale_line_items` (one row per product on a sale)
submission_id fk (and/or transaction_id fk after promotion), company_id fk (billing entity for this line), product_code, product_name, **commission_type (snapshot)**, line_sale_amount, quantity (default 1), selected_com_codes (jsonb / join), upgrade_parent_product_id (nullable), structure_version_id fk (resolved per line at verification), is_external (snapshot). The engine runs per line item (§8.1).

### 7.6 `sales_transactions` (header)
transaction_code (unique, auto), sales_date, client_name, client_contact, sale_amount (total), payment_mode, payment_plan, deposit, installment_count, amount_collected, closing_associate_id fk, closing_associate_name, **direct_upline_id (snapshot)**, **second_upline_id (snapshot)**, commission_eligibility enum {Eligible, Pending Collection, Partially Eligible, Ineligible}, agreement_file_key, verified_by, verified_at, remarks. *(Per-product detail lives in `sale_line_items`; invoices group lines by `company_id`.)*

### 7.7 `invoices`
transaction_id fk, company_id fk, invoice_number (unique per company), invoice_type enum {Computer-Generated, Signature}, installment_index (null for full), amount, status enum {Outstanding, Paid, Cancelled}, paid_date, paid_marked_by, pdf_file_key, signed_pdf_file_key, remarks.

### 7.8 `installment_plans` & `installment_schedule`
plan: transaction_id fk, total_amount, deposit, installment_count, adjustable_amount, status. schedule: plan_id fk, sequence, due_amount, due_date, invoice_id fk, paid (bool), paid_date. Drives eligibility recomputation.

### 7.9 `commission_ledger`
transaction_id fk, **line_item_id fk (which product line this commission came from)**, payout_month (YYYY-MM), associate_id fk (nullable for External Payable/Company Retained), associate_name, designation, line_type enum {Personal, Override, Add-on, Company Retained, External Payable}, com_code (nullable), basis_amount, rate_or_value, amount, **is_manual_override (bool)**, **override_reason**, eligibility, status enum {Pending, Eligible, Paid, Cancelled}, remarks.

### 7.10 `monthly_payouts`
payout_month, associate_id fk, associate_name, designation, personal_commission, override_commission, addon_commission, total_payable, payment_method, paynow_number, bank_name, bank_account_number, payout_status enum {Pending, Approved, Paid, Cancelled}, paid_date, statement_file_key, bank_file_batch_id, remarks. Unique (associate_id, payout_month).

### 7.11 `notices`
title, body, attachment_file_key, audience (all | team | role), posted_by, published_at. `notice_reads` (notice_id, user_id, read_at) optional.

### 7.12 `documents` (templates + admin-assigned sales agreements)
type enum {Company Template, Associate Agreement, Vendor Agreement, **Vendor MOU**, **Sales Agreement**, Other}, title, file_key, owner_associate_id (nullable for company templates), **assignment enum {All, Team, Associate}**, **assigned_team** (nullable), **assigned_associate_id fk (nullable)**, visibility, uploaded_by, active. The **Sales Agreements** tab (§6.11) lists `Vendor MOU` / `Sales Agreement` docs targeted to the viewing associate (by All / their Team / themselves); associates have download-only.

### 7.12a `name_cards` (digital name card / VCF) — mostly derived
Primarily **derived from the user/associate profile + company entity** at render time (name, designation, mobile, email, company, address, web, photo). Optional persisted columns if customisation is needed: user_id fk, company_id fk, custom_title, qr_payload, last_rendered_vcf_key, last_rendered_image_key. Endpoints generate `.vcf` (vCard) and a rendered image/PDF on demand.

### 7.13 `vendor_referrals`
vendor_name, vendor_type, contact, agreement_file_key, submitted_by_associate_id fk, **submitted_at (first-claim timestamp)**, status, remarks. View-only to associates.

### 7.14 `audit_log`
actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at.

### 7.15 Relationships (summary)
`associates` self-reference hierarchy → `sales_submissions` (header) → `sale_line_items` (one per product) → (verify) `sales_transactions` (+ upline snapshot; per-line structure version) → `invoices` (grouped by line `company_id`) + `installment_plans/schedule` → `commission_ledger` (per line item, incl. add-ons) → `monthly_payouts` (→ bank file batch). `products` versioned + `commission_type` + `com_codes` + upgrade parent. `companies` issue invoices. `notices`, `documents`, `vendor_referrals` are virtual-office features.

---

## 8. Commission engine — detailed logic

### 8.1 Algorithm (per verified, eligible transaction)
A transaction has **one or more line items**. The engine runs the per-line block below **for each line item** and sums the results; the transaction's commission = Σ(line commissions). Each line uses **its own product, structure version, commission type, line sale amount, and com codes**.

```
For EACH line_item in transaction:
Given: line.sale_amount, line.structure (commission_type, closing_comm_pct,
       closing_comm_fixed, company_cut_pct, asm/sm/sd override_pct),
       line.com_codes, closer, upline snapshot.

0. closing_commission =                                  // Commission Type branch
      commission_type == "Fixed"
        ? closing_comm_fixed                             // flat $ for the product
        : round2(line.sale_amount * closing_comm_pct/100)
1. (closing_commission as above)
2. company_cut_pool   = round2(closing_commission * company_cut_pct/100)   // SAME split for both types
3. net_to_closer      = closing_commission - company_cut_pool   // "Net Closing Commission Payable"

4. overrides = []
   for upline in [direct_upline, second_upline]:        // ascend chain (default depth 2)
       if upline is Approved+Active:
           rate = override_pct_for_rank(upline.designation)   // ASM/SM/SD
           amt  = round2(company_cut_pool * rate/100)
           overrides.push({upline, rate, amt})

5. total_override   = sum(overrides.amt)
6. company_retained = company_cut_pool - total_override

7. addons = []
   for code in line.com_codes (verified):
       amt = code.value_type=="Percentage"
             ? round2(line.sale_amount * code.value/100)   // % of line sale  [DECISION: of sale vs of commission; default = of line sale]
             : code.value                                  // absolute $
       addons.push({code, amt})        // attribution [DECISION]: default to closer

8. Ledger lines (each tagged with line_item_id + transaction_id):
     Personal:  closer,  basis=closing_commission, amount=net_to_closer
     Override:  each upline, basis=company_cut_pool, amount=amt
     Add-on:    closer (default), per code, amount=amt
     Company Retained: amount=company_retained
9. Assert (per line): net_to_closer + total_override + company_retained == closing_commission

After all lines: transaction totals = Σ over lines of each ledger line type.
```
`override_pct_for_rank`: ASM→asm%, SM→sm%, SD→sd%, Consultant→0.
**Per-line, then sum:** each line item runs the block independently (its own product/type/rates/com codes) and writes its own ledger lines tagged with `line_item_id`; the transaction's figures are the sum across lines. **External products** (§8.5) follow their branch per line.
**Rounding:** round each money value to 2 dp; push residual into Company Retained so each line's core split reconciles to that line's `closing_commission`. Add-ons are additive on top (extra payable), tracked separately.
**Depth [DECISION NEEDED]:** deck lists only direct + 2nd upline → default depth **2**; generalise step 4 for deeper chains if needed.

### 8.2 Worked example (must pass as a test)
```
Sale Amount               = $10,000
Closing Commission (10%)  = $1,000
Company Cut (40%)         = $400      (Company Cut Pool)
Net to closer (60%)       = $600
SM Override (20% of 400)  = $80       (direct upline = SM)
SD Override (10% of 400)  = $40       (2nd upline = SD)
Company Retained          = $280
Check: 600 + 80 + 40 + 280 = 1000 ✓
```
*(This is a single-line, Percentage-type example. A `Fixed`-type product would start at step 0 with `closing_commission = closing_comm_fixed` and then apply the identical 40% pool / 20% / 10% split. A multi-product sale runs this block per line and sums.)*

**Fixed-type example (single line):** product `closing_comm_fixed = $500`, company_cut 40%, SM 20%, SD 10% → pool $200, net-to-closer $300, SM $40, SD $20, retained $140 (300+40+20+140 = 500 ✓).

### 8.3 Eligibility & installment trigger
- `Ineligible` — closer not Approved+Active at sale time, or sale not verified.
- **Full Payment:** `Eligible` once verified and fully collected.
- **Installment (key rule from walkthrough):** commission becomes payable on a configured milestone — **default = the 3rd installment paid** (`commission_payout_installment_threshold`, configurable per product/global). Before that → `Pending Collection`.
  - **[DECISION NEEDED]** recognition mode: (a) **all-or-nothing at the threshold** (matches "3rd installment then pay out") — **default**, or (b) pro-rata per installment. Implement default (a) with a flag for (b).
- Eligibility recomputes automatically whenever an installment invoice is marked Paid; the engine re-runs idempotently for that transaction.
- `payout_month` = month the commission became eligible (collection/threshold date).

### 8.4 Rate changes
Editing override/commission rates creates a new structure version effective from a date; only transactions with Sales Date ≥ effective date use the new rate. Historical transactions and paid ledger lines are never recomputed.

### 8.5 External products (columbarium / niche / memorial)
For products flagged **External**, the standard pool/override model does not apply. Instead:
- The bulk of the sale is owed to the **external provider / "Shifu"** (recorded as an external-payable line, not an associate payout).
- **Enshrine retains only a small cut** (`external_company_retained`, e.g. a few %) for building/admin maintenance.
- Associate/upline commission on external products, if any, is paid from Enshrine's retained cut only — typically small or zero. Exact treatment per the client (§16).
- Ledger lines: `External Payable` (to provider) + `Company Retained` (Enshrine) + optional small `Personal`/`Override` from the retained cut.

### 8.6 Manual override
On any transaction, an Admin may set a **manual commission/override amount** that supersedes the computed value (for complex cascades/external cases). Manual entries are flagged, reasoned, and audit-logged; reconciliation assertions are relaxed for manually-overridden lines but the transaction total is still recorded.

---

## 9. Business rules & validations (consolidated)
1. Associate IDs immutable, sequential `EN####`.
2. Only Approved+Active associates can close sales or receive payouts.
3. Sales require Accounts/HR verification before commission flows.
4. Hierarchy acyclic; uplines must exist.
5. Override % are of the **pool**, not the sale; closer's commission is never reduced by overrides.
6. Commission structure versioned by effective date; history immutable.
7. Upline chain snapshotted onto each transaction at verification.
8. Installment commission gated by milestone (default 3rd installment).
9. No payment gateway in v1 — payments recorded manually via "Mark as Paid".
10. Invoices numbered per company entity; computer-generated invoices carry the no-signature footer.
11. Money SGD, 2-dp, reconciling; GST off by default but GST-ready.
12. PII (NRIC, bank account) encrypted, masked, access-logged.
13. Soft-delete only; everything audit-logged.
14. Paid payouts/invoices are locked.
15. Vendor referral registry is view-only to associates; timestamp = first claim.

---

## 10. Non-functional requirements
- **Security:** RBAC enforced server-side on every query; downline scoping via recursive CTE; signed URLs; CSRF protection; secure cookies.
- **Privacy / PDPA:** Singapore residency; PII encryption; consent at recruitment; retention policy; access/erasure tooling.
- **Auditability:** immutable audit log; reproducible commission runs.
- **Performance:** dashboards < 2s at 1,000 associates; engine handles thousands of transactions per batch; bank-file generation handles full roster.
- **Reliability:** engine idempotent; DB transactions around multi-row writes.
- **Usability (virtual office):** one-login self-service; clear empty states; bulk Admin actions (approve, verify, run payouts, generate bank file).
- **Responsive / mobile-first (§10.1):** the entire portal must be usable on mobile — see the dedicated requirement below.

### 10.1 Responsive design requirement (mobile-first)
The portal is a virtual office associates use on their phones, so **every page must be fully responsive**, built **mobile-first**, without breaking the desktop layout.

**Target breakpoints (verify each page at all three):**
- **375px** — mobile (minimum supported width)
- **768px** — tablet
- **1280px** — desktop

**Implementation rules**
- Use **Tailwind responsive utilities mobile-first**: base (unprefixed) classes target mobile; `sm:` / `md:` / `lg:` scale up. Do not add another CSS framework or restructure components unless necessary.
- **No horizontal scroll / overflow at 375px** on any page.
- **Navigation collapses** to a hamburger / mobile menu below the desktop breakpoint.
- **Multi-column grids / flex rows stack to a single column** on mobile.
- **Font sizes, padding, and tap targets scale down sensibly**; interactive tap targets are **≥ 44×44px** on mobile.
- **Images and tables never overflow their container** — tables scroll within a wrapper or reflow to stacked cards on mobile (commission ledger, payouts, transactions, dashboards).
- Forms (onboarding, sale submission with **multiple line items**, product creation) remain usable on a single mobile column; the multi-line sale form stacks each line item vertically.

**Acceptance criteria (per page):** describe/verify the layout at **375px, 768px, 1280px**; no overflow at 375px; nav collapses; grids stack; tap targets ≥ 44px; tables/images contained; desktop (1280px) layout unchanged from its current design.

**Scope:** all authenticated portal pages (Admin, Accounts, SalesDirector, SalesManager, Consultant areas) and the public/pre-login pages (login, candidate onboarding form, e-sign). See screen inventory §12.

> **Status note:** the app is not yet built; this is a build-time requirement. When implementing, keep changes minimal, prefer Tailwind `sm:/md:/lg:` prefixes, and provide a per-file summary of changes plus the 375/768/1280 layout description for each page (per `09_Test_Plan.md` / `TESTING.md` responsive checks).
- **Observability:** structured logs + error tracking.

---

## 11. Integrations & exports
- **Invoice PDF** (per company entity, two types).
- **Payout statement PDF** + **bank GIRO bulk-payout file** (associate payout only).
- **Google Contacts CSV** export.
- **Email** notifications (notices, approvals, payout-paid). *v1:* associates send client emails from their own email; system emails are transactional.
- File uploads (agreements, invoices, signed docs, photos) to object storage.
- **Deferred:** payment gateway (Stripe/HitPay/RedDot); AI image service (festive generator); separate Vendor/Logistics LMS.

---

## 12. Screens / information architecture
- **Auth & onboarding:** login, recruitment form, e-sign agreement, first-login photo capture, password reset.
- **Admin / Product Owner:** Recruitment queue, Associate Master, Companies, Products & Com Codes (+ upgrades), Commission rates/versions, Sales verification queue, Sales Transactions, Invoices (+ Outstanding tab), Installments, Commission Ledger, Commission Run console, Monthly Payouts + Bank File, Notices, Documents, Vendor Referrals, Users & Roles, Audit Log, Global Dashboard.
- **Manager (SM/SD):** Dashboard, Team Performance, Commission, Recruitment (downline), Submit Sale, Invoices (own), Notices, Documents, Vendor Registry (view).
- **Consultant:** Personal Dashboard, My Sales, Submit Sale, My Invoices, My Commissions, My Payouts, My Agreement, Notices, Documents, Vendor Registry (view).
- **Home feed:** notices/announcements scrollable on the main page.

---

## 13. Phased delivery plan
**Phase 0 — Mock/prototype:** clickable sample with mock data for sign-off on look & flow (the client expects a rough sample first).

**Phase 1 — Foundation & HR + virtual office shell:** auth + RBAC, associates schema, recruitment form, **e-sign agreement**, approval/status, hierarchy + cycle prevention, first-login photo, Contacts Export, home feed shell, Documents repository + "My Agreement", Notices. *Exit:* an associate is recruited, signs, is approved, logs into their virtual office, sees notices/documents.

**Phase 2 — Sales, Products & Invoicing:** Companies, Commission Structure (versioned) + **com codes/upgrades**, Sales Submission (with add-ons), **verification → Sales Transactions** (upline snapshot), **Invoicing (multi-company, two types, Outstanding tab, Mark-as-Paid)**, **Installments (auto-schedule + adjust)**. *Exit:* a sale flows submit → verify → transaction → invoice(s); installments schedule and can be marked paid.

**Phase 3 — Commission & Payout:** Auto Commission Engine (passes §8.2; add-ons; **installment threshold**), Commission Ledger, Monthly Payout + status workflow + statement PDF + **bank GIRO file**. *Exit:* a payout run produces correct, reconciling payouts and a valid bank file.

**Phase 4 — Dashboards & registry:** Personal/Manager/Director + Admin dashboards (targets, rankings, scoping), Vendor Referral Registry. *Exit:* scoped dashboards reconcile with ledger; registry enforces first-claim.

**Phase 5 — Hardening + deferred:** PDPA controls, audit UI, performance, full test suite; then (as funded) payment gateway, AI festive generator, and the separate Vendor/LMS.

---

## 14. Acceptance criteria (system-level)
- §8.2 example → $600/$80/$40/$280, reconciles to $1,000.
- Add-on com codes (percentage & absolute) compute and attribute correctly.
- A Pending/Inactive/unverified sale or associate never appears as a closer, in a payout, or in another manager's dashboard.
- Installment commission becomes payable only at the configured threshold (default 3rd installment), recomputing when an installment is marked Paid.
- Invoices issue per-company with unique numbers; computer-generated type shows the no-signature footer.
- Editing a rate from a date never alters historical payouts.
- Re-running the engine is idempotent.
- Bank payout file matches selected payouts and validates against the bank format.
- Managers/consultants are strictly scoped (permission test passes; out-of-scope = 403).
- Money reconciles with zero rounding leakage.

---

## 15. Test plan (high level)
- **Unit:** commission math (§8.2), override-by-rank, add-on percentage/absolute, installment threshold eligibility, rounding reconciliation, ID/invoice-number sequencing, cycle detection, GST-off math.
- **Integration:** recruit → e-sign → approve → submit (with add-ons) → verify → transaction → invoice/installments → mark-paid → engine → ledger → payout → bank file, end to end.
- **Permission:** §5 matrix server-side; downline scoping; PII masking; vendor registry view-only.
- **Regression:** structure versioning; idempotent re-runs; installment adjust preserves paid history; multi-company invoice numbering.

---

## 16. Open items / decisions to confirm
**Resolved in v1.4:** Commission Type = **Percentage | Fixed** with the **same company-cut/override split** (§6.5, §8.1); a sale form supports **multiple product line items**, commission computed **per line** (§6.3/§8.1); add-on percentage is of the **line** sale amount.

Most prior unknowns are resolved by the walkthrough. Remaining confirmations:
1. **Add-on com code basis** — percentage of line **sale** vs of line **commission**; default = of line sale. (§8.1)
2. **Add-on attribution** — to closer only vs split with upline; default = closer.
3. **Installment recognition** — all-or-nothing at 3rd installment (default) vs pro-rata; and whether the threshold is global or per-product.
4. **Override chain depth** — 2 levels (default) vs deeper.
5. **Company Retained %** — derived (default) vs explicitly entered.
6. **Payout timing** — monthly batch + ad-hoc ("money-fall"); confirm cadence and which triggers the bank file.
7. **Invoice mode** — per-company-type (default) vs consolidated; confirm "merge invoices" priority.
8. **E-sign** — in-house canvas (default) vs third-party provider; customer-facing remote e-sign timing.
9. **Bank file format** — confirm the exact bank/GIRO file spec to target.
10. **Multiple companies** — confirm the list of company entities and their invoice prefixes.
11. **Dashboard visibility** — reveal team-member-level detail to consultants now or later.
12. **External-product economics** — exact Enshrine retained cut % on columbarium/niche/memorial, and whether any associate commission is paid on them (§8.5).
13. **Company brands** — entities confirmed (Enshrine Services / Pets Paradise / Afterlife Planner Pte Ltd); still confirm each one's **invoice prefix** and which products bill under which entity.

---

## 17. Appendix — current data snapshot (from the prototype)
- **7 associates:** 2 Sales Directors (Sylvia Lee; Lim Xiong / "Vincent Lim"), 1 Sales Manager (Koo Hok Kian, under EN0001), 4 Sales Consultants (3 active + 1 Pending/Inactive), mostly under EN0002 (Vincent Lim Division).
- Approval/Status: 6 Approved / 1 Pending; 6 Active / 1 Inactive.
- Divisions: "Sylvia Lee Division", "Vincent Lim Division".
- Commission Structure: header only (rebuild per §7.3/§7.4; existing header had a duplicated "Direct Upline Override" column and no ASM/SM/SD split).
- Sales Transactions / Commission Ledger / Monthly Payout / Archive: empty scaffolding.
- Enums to preserve: Approval {Pending, Approved, Rejected, Incomplete}; Status {Active, Suspended, Terminated, Inactive}; Payout {Pending, Approved, Paid, Cancelled}.
- **Product lines / categories (from walkthrough + minutes):** Cremation, Religious Rites, Columbarium (niche), Sea Scattering, funeral services/packages, pet aftercare ("pet afterlife"), niche/memorial, temple/festive events — each with its own commission structure, add-on com codes, and possible upgrades. Columbarium/niche/memorial are typically **external** products (§8.5).
- **Company brands / invoice entities (confirmed):** Enshrine Services Pte Ltd, Enshrine Pets Paradise Pte Ltd, Enshrine Afterlife Planner Pte Ltd. Shared address 74 Lorong 6 Geylang, Singapore 399226; web enshrine.sg; tagline "Farewell with Grace, Care with Devotion / 以欣慰送别，以奉敬传爱".
- **Services taxonomy (from collateral):** Funeral Services; Post-Funeral Services; Pre-Funeral Planning; Pets Funeral Services; Pets Afterlife Services (incl. Columbarium); Additional Services — Exhumation, Relocation, Repatriation, Religious Ceremonies. Map these to product categories in the Commission Structure (§6.5); Columbarium is typically an **external** product (§8.5).

---

*End of PRD v1.1.*
