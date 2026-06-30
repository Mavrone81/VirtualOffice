# Workflow & Process Diagrams — Enshrine Associate Management Portal

**Version:** 1.2 · **Source of truth:** `Enshrine_Portal_PRD.md` v1.5 · **Anchors:** `02_Database_Diagram.md`, `05_RBAC.md`
**Engine:** PostgreSQL + Prisma · **Money:** `NUMERIC(14,2)` SGD · **Region:** Singapore (NRIC, PayNow, PDPA, GIRO, GST-ready/off)

This document captures the operational workflows of the portal as renderable **Mermaid** diagrams. Every entity, enum value, role and rate referenced here is taken verbatim from the anchor docs so the diagrams stay in lockstep with the schema (`02_Database_Diagram.md` §3 enums) and access model (`05_RBAC.md` §1–§3).

---

## Legend

Conventions used across all diagrams below:

- **Roles** (enum `app_role`): `Admin`, `Accounts`, `SalesDirector`, `SalesManager`, `Consultant`.
- **Designations** (org rank, enum `designation`): `Sales Consultant`, `Assistant Sales Manager` (ASM), `Sales Manager` (SM), `Sales Director` (SD).
- **Enum literals** are shown exactly as in `02_Database_Diagram.md` §3 (e.g. `approval_status = Approved`, `invoice_status = Outstanding`).
- **Entities / tables** are written in the schema's casing (e.g. `sales_transactions`, `sale_line_items`, `commission_ledger`, `monthly_payouts`).
- **Commission Type** (`commission_type`, per product/line) is exactly `Percentage` or `Fixed`: `Percentage` → closing commission = `line_sale_amount × closing_comm_pct`; `Fixed` → closing commission = `closing_comm_fixed`. **Both types feed the SAME company-cut pool → ASM/SM/SD override → company-retained split** (PRD §6.5, §8.1).
- A sale may carry **multiple product line items** (`sale_line_items`); the engine runs **per line** and sums, and invoices are **grouped by Company Entity** (one invoice per entity by default) (PRD §6.3/§6.5b/§8.1).
- Flowchart shapes: `[ ]` process · `{ }` decision · `([ ])` start/end · `[( )]` data store / table write.
- A dashed arrow (`-.->`) denotes an asynchronous / notification / recompute path.
- The **gating overlay** (`approval_status = Approved` AND `associate_status = Active`) is the precondition for closing, payouts, contacts export and dashboards (`05_RBAC.md` §2).

---

## 1. End-to-End Pipeline

The full lifecycle from candidate onboarding to dashboards. Admin creates a candidate (name + mobile + email), the system emails a tokenised onboarding link, the candidate fills the onboarding form and e-signs the auto-generated agreement (`onboarding_stage = Signed – Pending Approval`); on Admin approval the candidate converts to an Active associate, login is provisioned and the signed agreement is filed into the P-file (§6.2.1). The associate submits a sale, Accounts/HR verifies it into a `sales_transactions` record, invoices/installments are issued, the auto commission engine writes the `commission_ledger`, eligible lines aggregate into `monthly_payouts`, a GIRO bank file is generated, and everything reconciles into scoped dashboards.

```mermaid
flowchart TD
    A([Admin creates candidate<br/>name + mobile + email]) --> B[(candidates row<br/>onboarding_stage=Invited)]
    B --> B2[System emails tokenised<br/>onboarding link]
    B2 --> B3[Candidate fills Onboarding Form<br/>onboarding_stage=Form Submitted]
    B3 --> C[Auto-generate Associate Agreement]
    C --> D[Candidate e-signs agreement<br/>onboarding_stage=Signed - Pending Approval]
    D --> E{Admin / Accounts review}
    E -->|Approve| F[Convert to associate<br/>approval_status=Approved<br/>associate_status=Active<br/>provision login + file signed<br/>agreement into P-file<br/>Virtual office opens]
    E -->|Reject| Z([onboarding_stage=Rejected])
    F --> G[First-login photo capture]
    G --> H[Sales Submission<br/>sales_submissions header<br/>+ one or more sale_line_items<br/>status=Submitted]
    H --> I{Accounts / HR<br/>verification}
    I -->|Verified| J[(sales_transactions<br/>+ upline snapshot<br/>+ per-line structure_version)]
    I -->|Rejected| H
    J --> K[Invoicing<br/>group lines by company_id<br/>one invoice per company entity]
    K --> L[Installment schedule<br/>auto-generated if Installment]
    L --> M[Auto Commission Engine<br/>per line item, installment-aware]
    M --> N[(commission_ledger<br/>per line_item_id<br/>Personal / Override / Add-on<br/>Company Retained / External Payable)]
    N --> O[Monthly Payout aggregate<br/>monthly_payouts]
    O --> P[Generate GIRO bank file<br/>bank_file_batches]
    P --> Q[Mark Paid + lock rows]
    Q --> R([Dashboards:<br/>Personal / Manager / Director / Admin])
    N -.-> R
```

---

## 2. Candidate Onboarding (admin-initiated)

Detail of the first leg, now the **admin-initiated candidate flow** (PRD v1.3 §6.1). Admin enters a candidate's basic info (full name + mobile + email), creating a `candidates` row at `onboarding_stage = Invited`; the system emails a **secure, tokenised onboarding link** (no login required yet). The candidate fills the **Onboarding Form** (full associate detail set + photo → `Form Submitted`), the system auto-generates the Associate Agreement, and the candidate **e-signs** it online (with a **PDF-download → sign → re-upload fallback** for those who cannot sign on-screen) → `Signed – Pending Approval`. Admin/HR reviews and **approves** (candidate is **converted** to an associate with the next `EN####`, `approval_status = Approved`, `associate_status = Active`, login provisioned, the company-counter-signed agreement filed into the **P-file** §6.2.1) or **rejects** (`onboarding_stage = Rejected` with a reason). First login is blocked until a photo is confirmed.

> A public **Recruitment Form** is an alternative entry point that creates a candidate directly at `Form Submitted` (skipping the admin-invite step); the rest of the flow is identical.

```mermaid
flowchart TD
    A([Admin enters candidate basic info<br/>full name + mobile + email]) --> B[(candidates row<br/>onboarding_stage=Invited)]
    B --> C[System emails secure tokenised<br/>Onboarding Form link<br/>no login required]
    C --> D[Candidate fills Onboarding Form<br/>NRIC, DOB, address, bank/PayNow + photo<br/>onboarding_stage=Form Submitted]
    D --> E[Auto-generate Associate Agreement<br/>from template + submitted details<br/>agreement_file_key]
    E --> F{E-sign method}
    F -->|In-app canvas signature| G[Capture signature]
    F -->|Cannot sign on-screen| H[Download PDF -> sign offline<br/>-> re-upload signed PDF]
    G --> I[Store signed PDF<br/>signed_agreement_file_key<br/>onboarding_stage=Signed - Pending Approval]
    H --> I
    I --> J{Admin / HR review<br/>submission + signed agreement}
    J -->|Approve| K[Convert candidate -> associate<br/>associate_code=EN####<br/>approval_status=Approved<br/>associate_status=Active<br/>provision login / virtual office<br/>file signed agreement into P-file]
    J -->|Reject| L[onboarding_stage=Rejected<br/>reject_reason]
    K --> M[HR keys additional fields<br/>tier terms, payment details]
    M --> N{First login}
    N -->|Photo confirmed + password set| O([Virtual office active])
    N -->|No photo| P[Block login completion<br/>force photo capture]
    P --> N
```

Candidate `onboarding_stage` state machine (PRD §6.1.2 enum):

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Invited : Admin creates candidate<br/>(name + mobile + email)
    Invited --> FormSubmitted : candidate completes<br/>onboarding form
    FormSubmitted --> SignedPendingApproval : candidate e-signs<br/>auto-generated agreement
    SignedPendingApproval --> Approved : Admin/Accounts approve<br/>-> convert to Active associate
    SignedPendingApproval --> Rejected : Admin/Accounts reject<br/>(reject_reason)
    Approved --> [*]
    Rejected --> [*]

    state "Form Submitted" as FormSubmitted
    state "Signed - Pending Approval" as SignedPendingApproval

    note right of SignedPendingApproval
        "Signed, awaiting admin approval."
        Public Recruitment Form may enter
        directly at Form Submitted.
    end note
    note right of Approved
        On Approve: candidate -> associate
        (EN####), login provisioned, signed
        agreement filed into the P-file (§6.2.1).
    end note
```

---

## 3. Associate Status State Machine

Two independent enums govern an associate's lifecycle and together form the gating rule. `approval_status` is the HR review outcome; `associate_status` is the operational state. Only `approval_status = Approved` **AND** `associate_status = Active` lets an associate act as a closer, receive payouts, appear in Contacts export, or appear in manager dashboards (`05_RBAC.md` §2). `Terminated`/`Suspended` stop *future* eligibility but retain history.

```mermaid
stateDiagram-v2
    direction LR

    state "approval_status" as AP {
        [*] --> Pending
        Pending --> Approved : Admin/HR approves
        Pending --> Rejected : Admin/HR rejects
        Pending --> Incomplete : missing info
        Incomplete --> Pending : applicant resubmits
        Rejected --> [*]
    }

    state "associate_status" as AS {
        [*] --> Inactive
        Inactive --> Active : Approve + Activate
        Active --> Suspended : temporary hold
        Suspended --> Active : reinstated
        Active --> Terminated : exit
        Suspended --> Terminated : exit
        Terminated --> [*]
    }

    note right of AP
        Gating rule (both must hold):
        approval_status = Approved
        AND associate_status = Active
        -> may close sales, receive
        payouts, appear in Contacts
        export and dashboards.
    end note

    note right of AS
        Suspended / Terminated stop
        FUTURE commission eligibility
        but retain historical ledger.
        Contacts export includes
        Approved + (Active or Terminated).
    end note
```

---

## 4. Sales Submission → Verification → Transaction

The handoff between the closing **Associate**, the **System**, and **Accounts/HR**. A submission is a **header (`sales_submissions`) plus one or more `sale_line_items`** — a sale can include **multiple products**, each line carrying its own product, Company Entity, line sale amount, commission type and ticked com codes (PRD §6.3). A submission (`sales_submissions.status = Submitted`) is not official; only Accounts/HR verification promotes it to a `sales_transactions` row, which snapshots the upline chain and resolves a structure version **per line** by sales date. On invoicing, lines are **grouped by Company Entity → one invoice per entity** (a multi-entity sale yields multiple invoices). No commission appears on any dashboard before verification.

```mermaid
sequenceDiagram
    actor Assoc as Associate (closer)
    participant Sys as System
    participant Acc as Accounts / HR

    Assoc->>Sys: Submit sale header (client, payment_plan, deposit)<br/>+ one or more line items (product_code,<br/>company entity, line_sale_amount,<br/>commission_type, ticked com_codes)
    Sys->>Sys: Validate closer is Approved + Active
    Sys->>Sys: Validate amount_collected <= total sale_amount<br/>(= sum of line amounts), installment params,<br/>each line's product/add-ons active
    Sys-->>Acc: Queue sales_submissions (status=Submitted)<br/>with its sale_line_items
    Acc->>Sys: Open verification queue
    alt Verified
        Acc->>Sys: Verify / approve
        Sys->>Sys: Assign transaction_code (unique)
        Sys->>Sys: Snapshot direct_upline_id + second_upline_id
        Sys->>Sys: Resolve structure_version_id PER line by sales_date
        Sys->>Sys: Compute commission_eligibility
        Sys->>Sys: Group lines by company_id -> one invoice per entity
        Sys-->>Acc: Create sales_transactions + carried sale_line_items
        Sys-->>Assoc: Sale confirmed (now visible downstream)
    else Rejected
        Acc->>Sys: Reject with reason
        Sys-->>Assoc: Returned for correction (status=Rejected)
    end
```

---

## 5. Invoicing & Installment Lifecycle

Invoices are driven from the transaction. Because a sale can span multiple products under different Company Entities, lines are first **grouped by `company_id`** → **one invoice per company entity** by default (a single-entity sale = one invoice; consolidated is the alternative). A full-payment (single-entity) group gets one invoice; an installment sale auto-generates a schedule (one invoice per installment) using `installment = round((total − deposit) / n)` with residual on the final installment. Invoices carry `invoice_status ∈ {Outstanding, Paid, Cancelled}`; marking an invoice Paid (no payment gateway in v1) feeds eligibility. Plans are adjustable mid-way, preserving paid history.

```mermaid
flowchart TD
    A[(sales_transactions<br/>+ sale_line_items)] --> A2[Group line items by company_id<br/>one invoice group per company entity]
    A2 --> B{payment_plan}
    B -->|Full Payment| C[Issue one invoice per company group<br/>invoice_type:<br/>Computer-Generated or Signature]
    B -->|Installment| D[Create installment_plans<br/>total, deposit, installment_count]
    D --> E[Auto-gen installment_schedule<br/>installment = round((total-deposit)/n)<br/>residual on final]
    E --> F[Issue one invoice per installment<br/>installment_index set]
    C --> G[Invoice number per company<br/>INV-COMPANY-YYYY-#####]
    F --> G
    G --> H[(invoices status=Outstanding)]
    H --> I{Mark as Paid<br/>by Admin/Accounts}
    I -->|Paid| J[(status=Paid<br/>paid_date stamped)]
    I -->|Voided| K[(status=Cancelled<br/>terminal)]
    J -.-> L[Recompute eligibility<br/>re-run engine idempotently]
    M[Adjust plan mid-way] --> E
    M -.-> N[Preserve paid installments<br/>recompute remaining only]
```

Invoice status lifecycle (per invoice / per installment invoice):

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Outstanding : invoice issued
    Outstanding --> Paid : Mark as Paid (stamps paid_date)
    Outstanding --> Cancelled : void / re-issue
    Paid --> [*]
    Cancelled --> [*]
    note right of Paid
        Paid is locked.
        Feeds commission eligibility;
        for installments, flips the
        relevant installment_schedule row.
    end note
```

---

## 6. Auto Commission Engine

A transaction has **one or more line items** (`sale_line_items`); the engine **loops over each line**, computes that line's commission, writes ledger lines tagged with `line_item_id`, and the transaction figures are the **sum across lines** (PRD §8.1). At the **start of each line** a **Commission Type** decision branches the closing-commission basis: `Fixed` → `closing_commission = closing_comm_fixed` (flat $); `Percentage` → `closing_commission = line_sale_amount × closing_comm_pct`. **Both branches then feed the SAME company-cut pool → ASM/SM/SD override → company-retained split.** Overrides are paid **out of the pool**, so they never reduce the closer's net. The external-product branch routes the bulk to the provider (`External Payable`) and keeps only a small `external_company_retained_pct`. A manual override can supersede the computed value (Admin only).

```mermaid
flowchart TD
    A[(Verified + eligible<br/>sales_transactions)] --> L0{For EACH line_item<br/>in transaction}

    L0 --> M{line.is_external product?}

    M -->|No - Internal| CT{commission_type?}
    CT -->|Fixed| B1[closing_commission =<br/>closing_comm_fixed]
    CT -->|Percentage| B2[closing_commission =<br/>line_sale_amount x closing_comm_pct]
    B1 --> C[company_cut_pool =<br/>closing_commission x company_cut_pct]
    B2 --> C
    B1 --> D[net_to_closer =<br/>closing_commission - company_cut_pool]
    B2 --> D
    C --> E{Ascend upline chain<br/>depth 2: direct + second}
    E -->|upline Approved+Active| F[override = pool x override_pct_for_rank<br/>ASM% / SM% / SD%]
    E -->|Consultant or ineligible| G[override = 0]
    F --> H[company_retained =<br/>company_cut_pool - total_override]
    G --> H

    L0 --> I{line ticked com_codes<br/>verified?}
    I -->|Percentage| J[addon = line_sale_amount x value%]
    I -->|Absolute| K[addon = value $]

    M -->|Yes - External| N[External Payable =<br/>bulk to provider / Shifu]
    N --> O[Enshrine keeps<br/>external_company_retained_pct only]

    P{Manual override set?} -->|Yes - Admin| Q[Use manual amount<br/>is_manual_override=true<br/>override_reason logged]
    H --> P
    O --> P

    Q --> R[(commission_ledger lines<br/>tagged line_item_id + transaction_id)]
    D --> R
    F --> R
    J --> R
    K --> R
    N --> R
    O --> R

    R --> S[Assert per-line reconciliation:<br/>net_to_closer + total_override<br/>+ company_retained = closing_commission]
    S --> T{More line_items?}
    T -->|Yes| L0
    T -->|No| U[Transaction totals =<br/>sum over lines of each ledger line type]
```

Worked example A (`PRD §8.2` — Percentage type, single line — must pass as a test): a $10,000 internal sale with direct upline = SM and 2nd upline = SD.

```mermaid
flowchart LR
    A[Line Sale Amount<br/>$10,000<br/>commission_type=Percentage] --> B[Closing Commission 10%<br/>$1,000]
    B --> C[Company Cut 40%<br/>pool = $400]
    B --> D[Net to closer 60%<br/>$600 -> Personal]
    C --> E[SM Override 20% of 400<br/>$80 -> Override]
    C --> F[SD Override 10% of 400<br/>$40 -> Override]
    C --> G[Company Retained<br/>$280 -> Company Retained]
    D --> H{Check:<br/>600 + 80 + 40 + 280 = 1000}
    E --> H
    F --> H
    G --> H
```

Worked example B (`PRD §8.2` — **Fixed** type, single line — must pass as a test): a product with `closing_comm_fixed = $500`, company cut 40%, SM 20%, SD 10%. The Commission Type branch sets the closing commission to the flat $500, then the **identical** pool/override split applies.

```mermaid
flowchart LR
    A[Product<br/>commission_type=Fixed<br/>closing_comm_fixed=$500] --> B[Closing Commission<br/>$500 flat]
    B --> C[Company Cut 40%<br/>pool = $200]
    B --> D[Net to closer<br/>$300 -> Personal]
    C --> E[SM Override 20% of 200<br/>$40 -> Override]
    C --> F[SD Override 10% of 200<br/>$20 -> Override]
    C --> G[Company Retained<br/>$140 -> Company Retained]
    D --> H{Check:<br/>300 + 40 + 20 + 140 = 500}
    E --> H
    F --> H
    G --> H
```

---

## 7. Commission Eligibility / Installment Trigger

`commission_eligibility ∈ {Eligible, Pending Collection, Partially Eligible, Ineligible}`. Ineligible means closer was not Approved+Active at sale time or the sale is unverified. Full payment becomes Eligible once verified and fully collected. Installment sales default to paying out on the **3rd installment** (`commission_payout_installment_threshold`, configurable); before that they sit as `Pending Collection`. Eligibility recomputes whenever an installment invoice is marked Paid.

```mermaid
stateDiagram-v2
    direction TB
    [*] --> Ineligible : not verified OR<br/>closer not Approved+Active

    Ineligible --> PendingCollection : verified +<br/>payment_plan=Installment
    Ineligible --> Eligible : verified +<br/>Full Payment fully collected

    state "Pending Collection" as PendingCollection
    state "Partially Eligible" as PartiallyEligible

    PendingCollection --> PartiallyEligible : installment paid<br/>(below threshold, pro-rata mode)
    PartiallyEligible --> Eligible : 3rd installment paid<br/>(default threshold)
    PendingCollection --> Eligible : 3rd installment paid<br/>(all-or-nothing default)

    Eligible --> [*] : rolls into monthly_payouts

    note right of PendingCollection
        Default recognition: all-or-nothing
        at 3rd installment. payout_month =
        month commission became eligible.
        Recompute on every Mark as Paid
        (engine idempotent).
    end note
```

---

## 8. Monthly Payout & Bank File

Eligible `commission_ledger` lines aggregate per associate per `payout_month` into `monthly_payouts` (`Total Payable = Personal + Override + Add-on`). The payout row moves `payout_status` Pending → Approved → Paid (Cancelled terminal). A GIRO bank file (`bank_file_batches`) is generated for the selected approved payouts — **associate payout only**, not vendor/supplier payments — and marking Paid stamps the date and locks the row.

```mermaid
flowchart TD
    A[(commission_ledger<br/>status=Eligible lines)] --> B[Aggregate per associate<br/>per payout_month]
    B --> C[(monthly_payouts rows<br/>Total Payable = Personal +<br/>Override + Add-on)]
    C --> D[Generate payout statement PDF<br/>statement_file_key]
    C --> E{payout_status workflow}
    E -->|Approve| F[payout_status=Approved]
    F --> G[Generate GIRO bank file<br/>+ CSV -> bank_file_batches<br/>associate payout only]
    G --> H[Upload to bank]
    H --> I[Mark Paid:<br/>payout_status=Paid<br/>paid_date stamped + row locked]
    E -->|Cancel| J[payout_status=Cancelled<br/>terminal]
    E -->|Hold| K[stays payout_status=Pending<br/>incl. installment-incomplete]
```

Payout status lifecycle:

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Pending : aggregated
    Pending --> Approved : reviewed
    Pending --> Cancelled : voided
    Approved --> Paid : bank file + Mark Paid
    Approved --> Cancelled : voided
    Paid --> [*]
    Cancelled --> [*]
    note right of Paid
        Paid stamps paid_date and
        LOCKS the row (immutable).
    end note
```

---

## 9. Notice Broadcast

Admin/Accounts posts a notice (title, body, optional attachment, audience All/Team/Role). The system writes the `notices` row, delivers an in-app notification (bell + count) and an email, and surfaces it in the home feed. The associate reads it; an optional `notice_reads` row records the read.

```mermaid
sequenceDiagram
    actor Adm as Admin / Accounts
    participant Sys as System
    participant Email as Email service
    actor Assoc as Associate

    Adm->>Sys: Post notice (title, body, attachment,<br/>audience: All / Team / Role)
    Sys->>Sys: Write notices row (published_at)
    Sys-->>Assoc: In-app notification (bell + count)
    Sys->>Email: Send email to targeted associates
    Email-->>Assoc: Email notice
    Assoc->>Sys: Open home feed (scroll to read)
    Sys-->>Assoc: Render notice + attachment download
    Assoc->>Sys: Mark read (optional notice_reads row)
```

---

## 10. Vendor Referral First-Claim

An associate submits the Referred (Marketing) Partnership Registration with the agreement upload. The system records a **timestamped** `vendor_referrals` row; that `submitted_at` timestamp is the first-claim key. All associates get a **view-only** registry. If two associates approach the same vendor, the conflict is resolved by the earliest timestamp.

```mermaid
flowchart TD
    A([Associate signs a vendor]) --> B[Submit Referred Partnership form<br/>+ agreement upload]
    B --> C[(vendor_referrals row<br/>submitted_at = first-claim timestamp<br/>submitted_by_associate_id)]
    C --> D[Appears in view-only<br/>Vendor Referral Registry<br/>visible to all associates]
    D --> E{Two associates claim<br/>same vendor?}
    E -->|No| F([Single owner])
    E -->|Yes| G[Compare submitted_at]
    G --> H[Earliest timestamp wins<br/>first-claim]
    H --> I([Conflict resolved;<br/>later claim noted])
    J[Admin / Accounts] -.->|edit only| C
```

---

*End of Workflow & Process Diagrams v1.2 — adds per-line commission loop + Commission Type {Percentage, Fixed} decision branch and Fixed worked example, and multi-product / per-company-entity sales & invoicing (PRD v1.5 §6.3/§6.5/§8.1–§8.2).*
