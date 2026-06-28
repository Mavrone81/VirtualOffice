# Database Design & ERD — Enshrine Associate Management Portal

**Version:** 1.0 · **Source of truth:** `Enshrine_Portal_PRD.md` v1.2 (§7, §8)
**Engine:** PostgreSQL 15+ · **ORM:** Prisma · **IDs:** UUID v4 · **Money:** `NUMERIC(14,2)` SGD · **Timezone:** store UTC, render Asia/Singapore

> Conventions: every table has `id uuid PK`, `created_at timestamptz`, `updated_at timestamptz`; mutable tables also carry `created_by`/`updated_by` (uuid → users). Soft-delete via `archived_at timestamptz NULL`. Enums implemented as Postgres enums (listed in §3). Sensitive columns (`nric`, `bank_account_number`) are encrypted at rest and masked in the UI.

---

## 1. Entity-Relationship Diagram

```mermaid
erDiagram
    USERS ||--o| ASSOCIATES : "logs in as"
    ASSOCIATES ||--o{ ASSOCIATES : "direct_upline"
    ASSOCIATES ||--o{ SALES_SUBMISSIONS : "submits"
    ASSOCIATES ||--o{ SALES_TRANSACTIONS : "closes"
    COMPANIES ||--o{ SALES_TRANSACTIONS : "invoiced under"
    COMPANIES ||--o{ INVOICES : "issues"
    PRODUCTS ||--o{ COM_CODES : "has add-ons"
    PRODUCTS ||--o{ PRODUCTS : "upgrade_of"
    PRODUCTS ||--o{ SALES_SUBMISSIONS : "sold in"
    SALES_SUBMISSIONS ||--o| SALES_TRANSACTIONS : "promoted to"
    SALES_TRANSACTIONS ||--o{ INVOICES : "billed by"
    SALES_TRANSACTIONS ||--o| INSTALLMENT_PLANS : "may have"
    INSTALLMENT_PLANS ||--o{ INSTALLMENT_SCHEDULE : "contains"
    INSTALLMENT_SCHEDULE ||--o| INVOICES : "invoiced as"
    SALES_TRANSACTIONS ||--o{ COMMISSION_LEDGER : "generates"
    ASSOCIATES ||--o{ COMMISSION_LEDGER : "earns"
    COMMISSION_LEDGER ||--o{ MONTHLY_PAYOUTS : "aggregated into"
    ASSOCIATES ||--o{ MONTHLY_PAYOUTS : "receives"
    MONTHLY_PAYOUTS }o--o| BANK_FILE_BATCHES : "exported in"
    ASSOCIATES ||--o{ VENDOR_REFERRALS : "registers"
    ASSOCIATES ||--o{ DOCUMENTS : "owns"
    USERS ||--o{ NOTICES : "posts"
    NOTICES ||--o{ NOTICE_READS : "read by"
    PRODUCTS ||--o{ COMMISSION_STRUCTURE_VERSIONS : "versioned by"
    COMMISSION_STRUCTURE_VERSIONS ||--o{ SALES_TRANSACTIONS : "resolved for"
    USERS ||--o{ AUDIT_LOG : "acts"

    USERS {
        uuid id PK
        string email UK
        string password_hash
        enum role
        uuid associate_id FK
        bool is_active
    }
    ASSOCIATES {
        uuid id PK
        string associate_code UK
        string full_name
        string business_name
        string mobile_number
        string email
        string nric "encrypted"
        date date_of_birth
        enum designation
        uuid direct_upline_id FK
        uuid second_upline_id FK
        string recruiting_manager
        string team_name
        enum payment_method
        string paynow_number
        string bank_name
        string bank_account_number "encrypted"
        string agreement_file_key
        string signed_agreement_file_key
        string photo_file_key
        date join_date
        enum approval_status
        enum associate_status
        timestamptz archived_at
    }
    COMPANIES {
        uuid id PK
        string name
        string legal_name
        string invoice_prefix
        int invoice_next_seq
        bool gst_registered
        numeric gst_rate
        bool active
    }
    PRODUCTS {
        uuid id PK
        string product_code
        string product_name
        string product_category
        numeric closing_comm_pct
        numeric company_cut_pct
        numeric asm_override_pct
        numeric sm_override_pct
        numeric sd_override_pct
        numeric company_retained_pct
        bool is_external
        numeric external_company_retained_pct
        uuid parent_product_id FK
        enum active_status
        date effective_date
    }
    COM_CODES {
        uuid id PK
        uuid product_id FK
        string com_code
        string label
        enum value_type
        numeric value
        bool active
    }
    SALES_SUBMISSIONS {
        uuid id PK
        date sales_date
        string client_name
        string client_contact
        uuid company_id FK
        string product_code
        numeric sale_amount
        enum payment_plan
        numeric deposit
        int installment_count
        numeric amount_collected
        json selected_com_codes
        uuid closing_associate_id FK
        string invoice_file_key
        enum status
    }
    SALES_TRANSACTIONS {
        uuid id PK
        string transaction_code UK
        date sales_date
        string client_name
        string client_contact
        uuid company_id FK
        string product_code
        string product_name
        numeric sale_amount
        enum payment_plan
        numeric deposit
        int installment_count
        numeric amount_collected
        uuid closing_associate_id FK
        uuid direct_upline_id "snapshot"
        uuid second_upline_id "snapshot"
        enum commission_eligibility
        uuid structure_version_id FK
        uuid verified_by FK
        timestamptz verified_at
    }
    INVOICES {
        uuid id PK
        uuid transaction_id FK
        uuid company_id FK
        string invoice_number UK
        enum invoice_type
        int installment_index
        numeric amount
        enum status
        date paid_date
        string pdf_file_key
        string signed_pdf_file_key
    }
    INSTALLMENT_PLANS {
        uuid id PK
        uuid transaction_id FK
        numeric total_amount
        numeric deposit
        int installment_count
        numeric adjustable_amount
        enum status
    }
    INSTALLMENT_SCHEDULE {
        uuid id PK
        uuid plan_id FK
        int sequence
        numeric due_amount
        date due_date
        uuid invoice_id FK
        bool paid
        date paid_date
    }
    COMMISSION_STRUCTURE_VERSIONS {
        uuid id PK
        string product_code
        date effective_date
        json rate_snapshot
    }
    COMMISSION_LEDGER {
        uuid id PK
        uuid transaction_id FK
        string payout_month
        uuid associate_id FK
        string associate_name
        enum designation
        enum line_type
        string com_code
        numeric basis_amount
        numeric rate_or_value
        numeric amount
        bool is_manual_override
        string override_reason
        enum eligibility
        enum status
    }
    MONTHLY_PAYOUTS {
        uuid id PK
        string payout_month
        uuid associate_id FK
        numeric personal_commission
        numeric override_commission
        numeric addon_commission
        numeric total_payable
        enum payment_method
        string paynow_number
        string bank_name
        string bank_account_number "encrypted"
        enum payout_status
        date paid_date
        string statement_file_key
        uuid bank_file_batch_id FK
    }
    BANK_FILE_BATCHES {
        uuid id PK
        string payout_month
        string file_key
        enum status
        timestamptz generated_at
    }
    NOTICES {
        uuid id PK
        string title
        text body
        string attachment_file_key
        enum audience
        uuid posted_by FK
        timestamptz published_at
    }
    NOTICE_READS {
        uuid id PK
        uuid notice_id FK
        uuid user_id FK
        timestamptz read_at
    }
    DOCUMENTS {
        uuid id PK
        enum type
        string title
        string file_key
        uuid owner_associate_id FK
        enum visibility
    }
    VENDOR_REFERRALS {
        uuid id PK
        string vendor_name
        string vendor_type
        string contact
        string agreement_file_key
        uuid submitted_by_associate_id FK
        timestamptz submitted_at "first-claim"
        enum status
    }
    AUDIT_LOG {
        uuid id PK
        uuid actor_user_id FK
        string action
        string entity_type
        uuid entity_id
        json before_json
        json after_json
        timestamptz created_at
    }
```

---

## 2. Table-by-table data dictionary

> Only domain columns shown; assume `id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `archived_at` per conventions. PK = primary key, UK = unique, FK = foreign key.

### users
| Column | Type | Constraints | Notes |
|---|---|---|---|
| email | text | UK, not null | login |
| password_hash | text | not null | bcrypt/argon2 |
| role | enum app_role | not null | Admin, Accounts, SalesDirector, SalesManager, Consultant |
| associate_id | uuid | FK→associates, null | null for pure Admin |
| is_active | bool | default true | |

### associates
| Column | Type | Constraints | Notes |
|---|---|---|---|
| associate_code | text | UK, not null | `EN####`, sequential |
| full_name | text | not null | |
| business_name | text | | trading name |
| mobile_number | text | | SG 8-digit |
| email | text | | |
| nric | text | **encrypted** | masked in UI |
| date_of_birth | date | | |
| designation | enum designation | not null | Sales Consultant / Assistant Sales Manager / Sales Manager / Sales Director |
| direct_upline_id | uuid | FK→associates, null | null/division head |
| second_upline_id | uuid | FK→associates, null | auto-derivable |
| recruiting_manager | text | | |
| team_name | text | | division |
| payment_method | enum payment_method | | PayNow / Bank Transfer |
| paynow_number | text | | |
| bank_name | text | | |
| bank_account_number | text | **encrypted** | |
| agreement_file_key | text | | generated agreement |
| signed_agreement_file_key | text | | e-signed copy |
| photo_file_key | text | | first-login photo |
| join_date | date | | |
| approval_status | enum approval_status | not null, default Pending | Pending/Approved/Rejected/Incomplete |
| associate_status | enum associate_status | not null, default Inactive | Active/Suspended/Terminated/Inactive |

Constraints: no self-reference cycle (enforced in app + optional trigger); `associate_code` immutable.

### companies (invoice entities)
name, legal_name, logo_file_key, stamp_file_key, address, **invoice_prefix** (UK), **invoice_next_seq** int, gst_registered bool default false, gst_rate numeric default 0, active bool.

### products (commission structures, versioned)
product_code, product_name, product_category, commission_type, closing_comm_pct, company_cut_pct, asm_override_pct, sm_override_pct, sd_override_pct, company_retained_pct (derived), **is_external** bool default false, **external_company_retained_pct** numeric, parent_product_id (FK→products, for upgrades), active_status enum, effective_date date. **UK (product_code, effective_date).**

### com_codes (product add-ons)
product_id FK, com_code, label, value_type enum {Percentage, Absolute}, value numeric, active bool.

### sales_submissions
sales_date, client_name, client_contact, company_id FK, product_code, sale_amount, payment_plan enum {Full Payment, Installment}, deposit, installment_count, amount_collected, selected_com_codes jsonb, closing_associate_id FK, invoice_file_key, remarks, status enum {Submitted, Verified, Rejected}. Check: `amount_collected <= sale_amount`.

### sales_transactions
transaction_code UK, sales_date, client_name, client_contact, company_id FK, product_code, product_name, sale_amount, payment_plan, deposit, installment_count, amount_collected, closing_associate_id FK, **direct_upline_id (snapshot)**, **second_upline_id (snapshot)**, commission_eligibility enum, structure_version_id FK, agreement_file_key, verified_by FK→users, verified_at, remarks.

### invoices
transaction_id FK, company_id FK, **invoice_number UK** (per-company sequence), invoice_type enum {Computer-Generated, Signature}, installment_index int null, amount, status enum {Outstanding, Paid, Cancelled}, paid_date, paid_marked_by FK, pdf_file_key, signed_pdf_file_key, remarks.

### installment_plans / installment_schedule
plan: transaction_id FK, total_amount, deposit, installment_count, adjustable_amount, status enum {Active, Completed, Cancelled}.
schedule: plan_id FK, sequence int, due_amount, due_date, invoice_id FK, paid bool default false, paid_date. **UK (plan_id, sequence).**

### commission_structure_versions
Immutable snapshot of a product's rates at an effective date (product_code, effective_date, rate_snapshot jsonb). Transactions reference the row valid for their sales_date.

### commission_ledger
transaction_id FK, payout_month (YYYY-MM), associate_id FK (null for External Payable/Company Retained), associate_name, designation, **line_type** enum {Personal, Override, Add-on, Company Retained, External Payable}, com_code null, basis_amount, rate_or_value, amount, **is_manual_override** bool, override_reason, eligibility enum, status enum {Pending, Eligible, Paid, Cancelled}, remarks. **Reconciliation:** for a transaction, Personal + Override + Add-on + Company Retained (+ External Payable) ties to the relevant totals (§8 PRD).

### monthly_payouts
payout_month, associate_id FK, associate_name, designation, personal_commission, override_commission, addon_commission, total_payable, payment_method, paynow_number, bank_name, bank_account_number (encrypted), payout_status enum {Pending, Approved, Paid, Cancelled}, paid_date, statement_file_key, bank_file_batch_id FK, remarks. **UK (associate_id, payout_month).**

### bank_file_batches
payout_month, file_key, status enum {Generated, Uploaded, Reconciled}, generated_at, generated_by FK. Groups the payouts exported in one GIRO file.

### notices / notice_reads
notices: title, body, attachment_file_key, audience enum {All, Team, Role}, posted_by FK, published_at. notice_reads: notice_id FK, user_id FK, read_at. **UK (notice_id, user_id).**

### documents
type enum {Company Template, Associate Agreement, Vendor Agreement, Other}, title, file_key, owner_associate_id FK null, visibility enum {All, Owner, Admin}, uploaded_by FK.

### vendor_referrals
vendor_name, vendor_type, contact, agreement_file_key, submitted_by_associate_id FK, **submitted_at (first-claim timestamp)**, status enum {Active, Lapsed}, remarks. View-only to associates; editable by Admin/Accounts.

### audit_log
actor_user_id FK, action, entity_type, entity_id, before_json, after_json, created_at. Append-only.

---

## 3. Enumerated types
| Enum | Values |
|---|---|
| app_role | Admin, Accounts, SalesDirector, SalesManager, Consultant |
| designation | Sales Consultant, Assistant Sales Manager, Sales Manager, Sales Director |
| approval_status | Pending, Approved, Rejected, Incomplete |
| associate_status | Active, Suspended, Terminated, Inactive |
| payment_method | PayNow, Bank Transfer |
| payment_plan | Full Payment, Installment |
| product_active_status | Active, Inactive |
| com_value_type | Percentage, Absolute |
| submission_status | Submitted, Verified, Rejected |
| commission_eligibility | Eligible, Pending Collection, Partially Eligible, Ineligible |
| invoice_type | Computer-Generated, Signature |
| invoice_status | Outstanding, Paid, Cancelled |
| ledger_line_type | Personal, Override, Add-on, Company Retained, External Payable |
| ledger_status | Pending, Eligible, Paid, Cancelled |
| payout_status | Pending, Approved, Paid, Cancelled |
| notice_audience | All, Team, Role |
| document_type | Company Template, Associate Agreement, Vendor Agreement, Other |

---

## 4. Key indexes & integrity
- `associates(direct_upline_id)`, `associates(approval_status, associate_status)` — downline + gating queries.
- `sales_transactions(closing_associate_id)`, `(structure_version_id)`, `(commission_eligibility)`.
- `commission_ledger(associate_id, payout_month)`, `(transaction_id)`.
- `monthly_payouts(associate_id, payout_month)` UK.
- `invoices(company_id, invoice_number)` UK; invoice number allocated atomically from `companies.invoice_next_seq`.
- Recursive **downline closure** via CTE on `direct_upline_id` (used for scoping; consider a materialized closure table if depth/perf grows).
- All money writes wrapped in DB transactions; commission run is idempotent (delete+reinsert ledger lines per transaction).

---

## 5. Seed data (from prototype)
7 associates (EN0001–EN0007): 2 Sales Directors, 1 Sales Manager, 4 Consultants (1 Pending/Inactive); divisions "Sylvia Lee Division", "Vincent Lim Division". Seed at least one company entity (Enshrine) and a few products incl. one external (columbarium) for engine tests.
