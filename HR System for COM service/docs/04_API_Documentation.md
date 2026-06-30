# API Documentation — Enshrine Associate Management Portal

**Version:** 1.1 · **Source of truth:** `Enshrine_Portal_PRD.md` v1.5 · **Anchors:** `02_Database_Diagram.md` (entities/enums), `05_RBAC.md` (roles, scoping, route map)
**Stack:** Next.js (App Router) · PostgreSQL + Prisma · NextAuth/Auth.js (HTTP-only cookie sessions)

> This document specifies the **logical REST API** for the portal. In the Next.js App Router build, many of these operations are implemented as **server actions** rather than literal HTTP route handlers (see §10). The contract below — methods, paths, roles, scoping, request/response shapes, status codes — holds regardless of transport. Where a server action is the practical implementation, the equivalent REST endpoint is documented anyway so the system has a single authoritative surface map.

---

## 1. Conventions

### 1.1 Base URL
```
https://portal.enshrine.sg/api/v1
```
All paths below are relative to this base. Example: `GET /associates` → `https://portal.enshrine.sg/api/v1/associates`.

### 1.2 Authentication & sessions
- Auth is **email/password** via NextAuth/Auth.js. A successful login sets a **secure, HTTP-only, SameSite cookie session** (`__Secure-next-auth.session-token`). No bearer tokens are issued for first-party clients.
- Every request resolves a principal `{ userId, role, associateId }` from the session cookie (RBAC §4.1). Missing/invalid session → **401**.
- **CSRF:** because the session lives in a cookie, all **state-changing** requests (`POST`/`PUT`/`PATCH`/`DELETE`) must carry the Auth.js CSRF token. Fetch it from `GET /auth/csrf` and send it as the `x-csrf-token` header (and/or the double-submit `csrfToken` body field). Missing/invalid CSRF on a mutation → **403** (`code: CSRF_FAILED`). `GET`/`HEAD` are CSRF-exempt.
- **Field-level masking:** `nric` and `bank_account_number` are returned **masked** (`S****892A`) to everyone except `Admin`/`Accounts` (RBAC §4.5). Decryption + access is itself audit-logged.

### 1.3 Content type
- Requests and responses are `application/json; charset=utf-8` unless stated otherwise.
- File uploads use `multipart/form-data`; binary downloads (PDF, GIRO file, CSV) return the appropriate `Content-Type` + `Content-Disposition: attachment`.

### 1.4 Pagination
List endpoints accept `?page` (1-based, default `1`) and `?pageSize` (default `20`, max `100`). Responses wrap rows in a `data` array plus a `meta` block:
```json
{
  "data": [ /* rows */ ],
  "meta": { "page": 1, "pageSize": 20, "totalItems": 137, "totalPages": 7 }
}
```

### 1.5 Filtering & sorting
- **Filtering:** field-named query params, e.g. `?approval_status=Approved&associate_status=Active`. Multi-value via comma: `?associate_status=Active,Terminated`. Date ranges via `?from=YYYY-MM-DD&to=YYYY-MM-DD`. Free-text via `?q=`.
- **Sorting:** `?sort=field` ascending, `?sort=-field` descending; multiple comma-separated: `?sort=-sales_date,client_name`.
- Unknown filter/sort fields → **400** (`code: INVALID_QUERY`).

### 1.6 Idempotency (commission run & batch jobs)
- Mutating batch operations — chiefly the **commission run** (`POST /commission/run`) and **payout/bank-file generation** — accept an `Idempotency-Key` header (client-generated UUID). The server stores the key + result; a retry with the same key returns the original result instead of re-executing.
- The commission engine is **also idempotent by design**: it deletes and re-inserts ledger lines per transaction (DB §4), so re-running after an installment is marked paid or a rate change never produces duplicate lines. Paid ledger/payout rows are locked and never recomputed.

### 1.7 Error envelope
All non-2xx responses use:
```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable summary.",
    "details": [
      { "field": "amount_collected", "issue": "must be <= sale_amount" }
    ]
  }
}
```
`details` is optional and used mainly for **422** validation failures. `code` is stable and machine-matchable; `message` may change.

### 1.8 HTTP status usage
| Status | Meaning in this API |
|---|---|
| **200 OK** | Successful read or mutation that returns the resource/result. |
| **201 Created** | A new resource was created (submission, invoice, notice, etc.). |
| **400 Bad Request** | Malformed request — bad JSON, unknown filter/sort, wrong type. |
| **401 Unauthorized** | No valid session. |
| **403 Forbidden** | Authenticated but not permitted: role denied, **out-of-scope** (downline), CSRF failure, masked-field access. Out-of-scope reads return 403, never an empty 200 (RBAC §2). |
| **404 Not Found** | Resource does not exist (or is archived and caller can't see it). |
| **409 Conflict** | State conflict — e.g. verifying an already-verified submission, marking a locked/paid invoice, duplicate invoice number, cyclic upline. |
| **422 Unprocessable Entity** | Well-formed but fails business validation (e.g. overrides exceed 100% of pool, `amount_collected > sale_amount`, installment params invalid). |
| **500 Internal Server Error** | Unhandled server fault. |

### 1.9 Common codes
`UNAUTHENTICATED`, `FORBIDDEN`, `OUT_OF_SCOPE`, `CSRF_FAILED`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED`, `INVALID_QUERY`, `RATE_LIMITED`, `INTERNAL`.

---

## 2. Auth endpoints

> Backed by Auth.js. Paths shown under `/api/v1/auth` for documentation symmetry; in the Next.js build these map to the Auth.js handler (`/api/auth/*`).

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/auth/csrf` | public | Returns CSRF token for subsequent mutations. |
| `POST` | `/auth/login` | public | Credentials sign-in; sets session cookie. |
| `POST` | `/auth/logout` | authenticated | Clears session cookie. |
| `GET` | `/auth/session` (alias `/auth/me`) | authenticated | Current principal + linked associate summary. |
| `POST` | `/auth/password/forgot` | public | Sends reset email if account exists (always 200, no enumeration). |
| `POST` | `/auth/password/reset` | public (token) | Sets new password from emailed token. |
| `POST` | `/auth/password/change` | authenticated | Change own password (requires current). |

**`POST /auth/login`** — request:
```json
{ "email": "consultant@enshrine.sg", "password": "••••••••", "csrfToken": "..." }
```
Response `200` (cookie set via `Set-Cookie`):
```json
{
  "user": { "id": "u_01H...", "email": "consultant@enshrine.sg", "role": "Consultant" },
  "associate": { "id": "a_01H...", "associate_code": "EN0005", "full_name": "Tan Wei Ming", "designation": "Sales Consultant" }
}
```
Invalid credentials → **401** `{ "error": { "code": "UNAUTHENTICATED", "message": "Invalid email or password." } }`.

**`GET /auth/session`** — response `200`:
```json
{
  "userId": "u_01H...",
  "role": "SalesManager",
  "associateId": "a_01H...",
  "associate_code": "EN0003",
  "full_name": "Koo Hok Kian",
  "designation": "Sales Manager",
  "must_capture_photo": false
}
```
`must_capture_photo` enforces the first-login selfie gate (PRD §6.1).

**`POST /auth/password/reset`** — request:
```json
{ "token": "reset_8f3...", "password": "newP@ssw0rd", "csrfToken": "..." }
```
Response `200`: `{ "ok": true }`. Expired/invalid token → **422** `code: VALIDATION_FAILED`.

---

## 3. Resource endpoints

> Roles use RBAC §1 names: `Admin`, `Accounts`, `SalesDirector`, `SalesManager`, `Consultant`. **Scope** legend: **global** (all rows) · **downline** (self + recursive `direct_upline_id` closure) · **own** (own records) · **self**. Gating overlay (RBAC §2): only `approval_status = Approved` AND `associate_status = Active` associates may be a closer, receive payouts, or appear in Contacts/manager dashboards.

### 3.1 Associates / Recruitment

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/recruitment/applications` | public | — (creates Pending/Inactive associate) |
| `POST` | `/recruitment/applications/{id}/agreement/sign` | public (e-sign token) / applicant | — |
| `GET` | `/recruitment/applications` | Admin, Accounts | global |
| `GET` | `/associates` | Admin, Accounts (global); SalesDirector, SalesManager (downline); Consultant (self) | scoped |
| `GET` | `/associates/{id}` | as above | scoped |
| `PATCH` | `/associates/{id}` | Admin, Accounts | global |
| `POST` | `/associates/{id}/approve` | Admin, Accounts | global |
| `POST` | `/associates/{id}/reject` | Admin, Accounts | global |
| `PATCH` | `/associates/{id}/status` | Admin, Accounts | global |
| `POST` | `/associates/{id}/photo` | self | self (first-login capture) |
| `GET` | `/associates/contacts.csv` | Admin, Accounts | global (export) |

**`POST /recruitment/applications`** (the Recruitment Form, PRD §6.1/§7.1) — request:
```json
{
  "full_name": "Lim Jia Hui",
  "business_name": "JH Memorial Services",
  "mobile_number": "91234567",
  "email": "jiahui@example.com",
  "nric": "S9012345A",
  "date_of_birth": "1990-04-12",
  "designation": "Sales Consultant",
  "direct_upline_id": "a_01HVINCENT",
  "recruiting_manager": "Vincent Lim",
  "team_name": "Vincent Lim Division",
  "payment_method": "PayNow",
  "paynow_number": "91234567",
  "csrfToken": "..."
}
```
Response `201`:
```json
{
  "id": "a_01HNEW",
  "associate_code": "EN0008",
  "approval_status": "Pending",
  "associate_status": "Inactive",
  "agreement_file_key": "agreements/EN0008/associate-agreement.pdf",
  "agreement_sign_url": "https://files.../signed-url?...",
  "second_upline_id": "a_01HSYLVIA"
}
```
- `second_upline_id` is **auto-derived** from the direct upline's direct upline (PRD §6.1). Cyclic upline → **409** `code: CONFLICT`. Missing upline → **422**.

**`POST /recruitment/applications/{id}/agreement/sign`** (in-app e-sign, PRD §6.1) — request (`multipart/form-data`): `signature_png` (canvas capture) or signed PDF blob. Response `200`:
```json
{ "id": "a_01HNEW", "signed_agreement_file_key": "agreements/EN0008/signed.pdf", "signed_at": "2026-06-28T09:14:00Z" }
```

**`POST /associates/{id}/approve`** — request: `{ "associate_status": "Active", "remarks": "Reviewed; agreement signed.", "csrfToken": "..." }`. On Approve+Active the login is provisioned (PRD §6.1). Response `200`:
```json
{ "id": "a_01HNEW", "approval_status": "Approved", "associate_status": "Active", "user_provisioned": true }
```
Re-approving an already-Approved associate → **409**.

**`PATCH /associates/{id}/status`** — request: `{ "associate_status": "Suspended", "remarks": "Pending compliance review", "csrfToken": "..." }`. Terminated/Suspended stop **future** eligibility but retain history (PRD §6.2). Allowed `associate_status`: `Active`, `Suspended`, `Terminated`, `Inactive`. Response `200` returns the updated associate.

**`GET /associates/{id}`** — response `200` (fields masked for non-Admin/Accounts):
```json
{
  "id": "a_01H...",
  "associate_code": "EN0005",
  "full_name": "Tan Wei Ming",
  "designation": "Sales Consultant",
  "email": "tan@example.com",
  "mobile_number": "98765432",
  "nric": "S****345A",
  "direct_upline_id": "a_01HVINCENT",
  "second_upline_id": "a_01HSYLVIA",
  "team_name": "Vincent Lim Division",
  "payment_method": "PayNow",
  "paynow_number": "98765432",
  "bank_account_number": "****",
  "approval_status": "Approved",
  "associate_status": "Active",
  "join_date": "2025-11-03"
}
```

**`GET /associates/contacts.csv`** (Contacts Export, PRD §6.9) — returns `text/csv`, Google-Contacts-compatible. Filter is fixed: `approval_status = Approved` AND `associate_status ∈ {Active, Terminated}`. Columns: `Associate ID, Full Name, Designation, Email, Mobile, DOB, Status`.

### 3.1a Candidates / Admin-initiated Onboarding

> Admin-initiated candidate flow (PRD §6.1, schema §7.1a). Lifecycle: `Invited → Form Submitted → Signed – Pending Approval → Approved/Rejected`. The onboarding form + e-sign endpoints are **public** (tokenised, no login). Approval converts the candidate into an `associate` and provisions the login.

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/candidates` | Admin, Accounts | global (create + email onboarding link) |
| `GET` | `/candidates` | Admin, Accounts | global |
| `GET` | `/candidates/{id}` | Admin, Accounts | global |
| `GET` | `/onboarding/{token}` | public (token) | — (fetch onboarding form) |
| `POST` | `/onboarding/{token}` | public (token) | — (submit form → generates agreement) |
| `POST` | `/onboarding/{token}/sign` | public (token) | — (e-sign agreement) |
| `POST` | `/candidates/{id}/approve` | Admin, Accounts | global (converts to associate) |
| `POST` | `/candidates/{id}/reject` | Admin, Accounts | global |

**`POST /candidates`** (PRD §6.1.1) — create a candidate with minimal info; system emails a tokenised onboarding link. Request:
```json
{ "full_name": "Lim Jia Hui", "mobile_number": "91234567", "email": "jiahui@example.com", "intended_designation": "Sales Consultant", "intended_direct_upline_id": "a_01HVINCENT", "intended_team": "Vincent Lim Division", "csrfToken": "..." }
```
Only `full_name`, `mobile_number`, `email` are required. Response `201`:
```json
{ "id": "cand_01H...", "onboarding_stage": "Invited", "invited_by": "u_01HADMIN", "onboarding_email_sent": true }
```

**`GET /candidates`** — paginated list. Filter via `?onboarding_stage=Signed – Pending Approval`. Each row returns `id`, `full_name`, `mobile_number`, `email`, `onboarding_stage`, `invited_by`, `created_at`.

**`GET /onboarding/{token}`** (public) — returns the onboarding-form schema + any pre-filled candidate basics. Invalid/expired token → **404**. Response `200`:
```json
{ "candidate_id": "cand_01H...", "onboarding_stage": "Invited", "prefill": { "full_name": "Lim Jia Hui", "mobile_number": "91234567", "email": "jiahui@example.com" } }
```

**`POST /onboarding/{token}`** (public) — submit the full associate detail set (§7.1) + profile photo. On submit → `onboarding_stage = Form Submitted` and the system **auto-generates the Associate Agreement**. `multipart/form-data` (`photo` file) plus JSON payload:
```json
{ "nric": "S9012345A", "date_of_birth": "1990-04-12", "address": "...", "payment_method": "PayNow", "paynow_number": "91234567", "bank_name": "DBS", "bank_account_number": "1234567890" }
```
Response `200`:
```json
{ "candidate_id": "cand_01H...", "onboarding_stage": "Form Submitted", "agreement_file_key": "agreements/cand_01H.../associate-agreement.pdf" }
```

**`POST /onboarding/{token}/sign`** (public e-sign, PDF-download-and-reupload fallback supported) — `multipart/form-data` with `signature_png` (canvas) or signed PDF blob. On signing → `onboarding_stage = Signed – Pending Approval`. Response `200`:
```json
{ "candidate_id": "cand_01H...", "onboarding_stage": "Signed – Pending Approval", "signed_agreement_file_key": "agreements/cand_01H.../signed.pdf" }
```

**`POST /candidates/{id}/approve`** (PRD §6.1.1) — converts the candidate to an `Active` associate (next `EN####`), provisions the virtual-office login, and files the company-counter-signed agreement into the new associate's P-file (§3.1b). Request: `{ "remarks": "Reviewed; agreement signed.", "csrfToken": "..." }`. Approving a candidate not in `Signed – Pending Approval` → **409**. Response `200`:
```json
{ "candidate_id": "cand_01H...", "onboarding_stage": "Approved", "converted_associate_id": "a_01HNEW", "associate_code": "EN0008", "approval_status": "Approved", "associate_status": "Active", "user_provisioned": true, "pfile_agreement_filed": true }
```

**`POST /candidates/{id}/reject`** — request: `{ "reject_reason": "Incomplete documents.", "csrfToken": "..." }`. Sets `onboarding_stage = Rejected`. Response `200`:
```json
{ "candidate_id": "cand_01H...", "onboarding_stage": "Rejected", "reject_reason": "Incomplete documents.", "reviewed_by": "u_01HADMIN" }
```

### 3.1b P-File (personnel file)

> Per-user document store (PRD §6.2.1, schema §7.1b). Owner can view/download their **own** P-file; Admin/Accounts/HR manage all. Managers do **not** see downline P-files (HR-sensitive). NRIC/bank remain masked per RBAC §4.5.

| Method | Path | Role | Scope |
|---|---|---|---|
| `GET` | `/associates/{id}/pfile` | owner (self); Admin, Accounts (global) | self / global |
| `POST` | `/associates/{id}/pfile` | Admin, Accounts | global (upload a P-file document) |
| `GET` | `/pfile-documents/{id}/download` | owner (own); Admin, Accounts | scoped |

**`GET /associates/{id}/pfile`** — response `200`:
```json
{
  "associate_id": "a_01HSELF",
  "p_file_id": "pf_01H...",
  "documents": [
    { "id": "pfd_01H...", "doc_type": "Signed Associate Agreement", "title": "Counter-signed Associate Agreement", "filed_by": "u_01HADMIN", "filed_at": "2026-06-28T09:30:00Z" }
  ]
}
```
A Consultant requesting another associate's P-file → **403** `code: OUT_OF_SCOPE`.

**`POST /associates/{id}/pfile`** (Admin/Accounts upload) — `multipart/form-data`: `file`, `doc_type`, `title`. `doc_type ∈ {Signed Associate Agreement, Onboarding Submission, ID Document, HR Document, Other}`. Filing is audit-logged. Response `201`:
```json
{ "id": "pfd_01H...", "p_file_id": "pf_01H...", "doc_type": "ID Document", "title": "NRIC scan", "filed_by": "u_01HADMIN", "filed_at": "2026-06-28T09:35:00Z" }
```

**`GET /pfile-documents/{id}/download`** — returns the file via short-lived signed URL; owner may download own documents, Admin/Accounts any. Out-of-scope → **403**.

### 3.2 Companies (invoice entities)

| Method | Path | Role | Scope |
|---|---|---|---|
| `GET` | `/companies` | Admin, Accounts, SalesDirector, SalesManager, Consultant | global (read) |
| `POST` | `/companies` | Admin | global |
| `GET` | `/companies/{id}` | all authenticated | global (read) |
| `PATCH` | `/companies/{id}` | Admin | global |

**`POST /companies`** (PRD §6.5b/§7.2) — request:
```json
{
  "name": "Enshrine Pets Paradise",
  "legal_name": "Enshrine Pets Paradise Pte Ltd",
  "address": "74 Lorong 6 Geylang, Singapore 399226",
  "invoice_prefix": "EPP",
  "invoice_next_seq": 1,
  "gst_registered": false,
  "gst_rate": 0,
  "active": true,
  "csrfToken": "..."
}
```
Response `201`:
```json
{ "id": "co_01H...", "name": "Enshrine Pets Paradise", "invoice_prefix": "EPP", "invoice_next_seq": 1, "active": true }
```
Duplicate `invoice_prefix` → **409**.

### 3.3 Products + Com Codes + Structure Versions

| Method | Path | Role | Scope |
|---|---|---|---|
| `GET` | `/products` | all authenticated (selectable list filtered to `Active`) | global |
| `POST` | `/products` | Admin | global |
| `GET` | `/products/{id}` | all authenticated | global |
| `PATCH` | `/products/{id}` | Admin | global |
| `POST` | `/products/{id}/rate-change` | Admin | global (new effective-dated version) |
| `GET` | `/products/{id}/versions` | Admin, Accounts | global |
| `GET` | `/products/{id}/com-codes` | all authenticated | global |
| `POST` | `/products/{id}/com-codes` | Admin | global |
| `PATCH` | `/com-codes/{id}` | Admin | global |

**`POST /products`** (PRD §6.5/§7.3) — `commission_type ∈ {"Percentage", "Fixed"}` drives the closing-commission basis; both types feed the **same** company-cut pool + ASM/SM/SD override split (§3.8). A **Percentage** product uses `closing_comm_pct` (closing commission = `sale × closing_comm_pct`); a **Fixed** product uses `closing_comm_fixed` (a flat $ per product, independent of sale amount). Validation: Percentage requires `closing_comm_pct`; Fixed requires `closing_comm_fixed` (else **422**).

*Percentage example* — request:
```json
{
  "product_code": "FUN-BASE",
  "product_name": "Funeral System (Base)",
  "product_category": "Funeral",
  "commission_type": "Percentage",
  "closing_comm_pct": 10,
  "closing_comm_fixed": null,
  "company_cut_pct": 40,
  "asm_override_pct": 0,
  "sm_override_pct": 20,
  "sd_override_pct": 10,
  "is_external": false,
  "external_company_retained_pct": 0,
  "default_company_id": "co_01HENSHRINE",
  "parent_product_id": null,
  "active_status": "Active",
  "effective_date": "2026-01-01",
  "csrfToken": "..."
}
```
*Fixed example* — request:
```json
{
  "product_code": "PET-CREMATE",
  "product_name": "Pet Cremation Package",
  "product_category": "Pet Aftercare",
  "commission_type": "Fixed",
  "closing_comm_pct": null,
  "closing_comm_fixed": 500.00,
  "company_cut_pct": 40,
  "asm_override_pct": 0,
  "sm_override_pct": 20,
  "sd_override_pct": 10,
  "is_external": false,
  "external_company_retained_pct": 0,
  "default_company_id": "co_01HPETS",
  "parent_product_id": null,
  "active_status": "Active",
  "effective_date": "2026-01-01",
  "csrfToken": "..."
}
```
- `company_retained_pct` is **derived** by default (`100 − (asm+sm+sd)` of the pool). Validation: `asm_override_pct + sm_override_pct + sd_override_pct + company_retained_pct = 100` (% of pool). Overrides exceeding 100% → **422** `code: VALIDATION_FAILED`.
- `default_company_id` is the product's default billing entity (copied onto each sale line item; PRD §7.3). For external products (columbarium/niche/memorial, PRD §8.5) set `is_external: true` and `external_company_retained_pct` (small cut Enshrine keeps).
- `PATCH /products/{id}` accepts the same fields (incl. `commission_type`, `closing_comm_fixed`, `default_company_id`); material rate changes should go through `POST /products/{id}/rate-change` for effective-dated versioning.

Response `201` (Fixed example):
```json
{
  "id": "p_01H...",
  "product_code": "PET-CREMATE",
  "product_name": "Pet Cremation Package",
  "product_category": "Pet Aftercare",
  "commission_type": "Fixed",
  "closing_comm_pct": null,
  "closing_comm_fixed": 500.00,
  "company_cut_pct": 40,
  "asm_override_pct": 0,
  "sm_override_pct": 20,
  "sd_override_pct": 10,
  "company_retained_pct": 70,
  "is_external": false,
  "default_company_id": "co_01HPETS",
  "active_status": "Active",
  "effective_date": "2026-01-01"
}
```

**`POST /products/{id}/rate-change`** (effective-dated versioning, PRD §6.5/§8.4) — request:
```json
{
  "effective_date": "2026-07-01",
  "changes": { "sm_override_pct": 15 },
  "apply_to_all_from_date": false,
  "remarks": "Direct upline override 20% → 15% from Jul 2026.",
  "csrfToken": "..."
}
```
Creates a **new version** effective from the date; transactions use the version active on their `sales_date`. Historical/paid lines are never recomputed. Response `201`:
```json
{
  "version_id": "csv_01H...",
  "product_code": "FUN-BASE",
  "effective_date": "2026-07-01",
  "rate_snapshot": { "closing_comm_pct": 10, "company_cut_pct": 40, "sm_override_pct": 15, "sd_override_pct": 10 }
}
```

**`POST /products/{id}/com-codes`** (add-ons, PRD §6.5/§7.4) — request:
```json
{ "com_code": "SCATTER", "label": "Sea Scattering Add-on", "value_type": "Percentage", "value": 2, "active": true, "csrfToken": "..." }
```
`value_type ∈ {Percentage, Absolute}`. Response `201`:
```json
{ "id": "cc_01H...", "product_id": "p_01H...", "com_code": "SCATTER", "label": "Sea Scattering Add-on", "value_type": "Percentage", "value": 2, "active": true }
```

### 3.4 Sales Submissions

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/sales/submissions` | Admin, Accounts, SalesDirector, SalesManager, Consultant | own (closer defaults to self) |
| `GET` | `/sales/submissions` | Admin, Accounts (global); SD/SM (downline); Consultant (self) | scoped |
| `GET` | `/sales/submissions/{id}` | as above | scoped |

**`POST /sales/submissions`** (PRD §6.3/§7.5/§7.5a) — the body is a **header plus a `line_items[]` array**: one or more products per sale, each line carrying its own product, billing entity, line amount, com codes, and optional upgrade reference. `sale_amount` is the **total** and is **server-computed/validated** as the sum of `line_items[].line_sale_amount × quantity`. Request:
```json
{
  "sales_date": "2026-06-25",
  "client_name": "Mdm Goh",
  "client_contact": "90011223",
  "sale_amount": 10500.00,
  "payment_type": "Installment",
  "payment_plan": "Installment",
  "deposit": 1000.00,
  "installment_count": 9,
  "amount_collected": 1000.00,
  "closing_associate_id": "a_01HSELF",
  "invoice_file_key": "uploads/tmp/agreement-scan.pdf",
  "remarks": "Walk-in referral; funeral + pet cremation.",
  "line_items": [
    {
      "product_code": "FUN-BASE",
      "company_id": "co_01HENSHRINE",
      "line_sale_amount": 10000.00,
      "quantity": 1,
      "selected_com_codes": ["SCATTER"],
      "upgrade_parent_product_id": null
    },
    {
      "product_code": "PET-CREMATE",
      "company_id": "co_01HPETS",
      "line_sale_amount": 500.00,
      "quantity": 1,
      "selected_com_codes": [],
      "upgrade_parent_product_id": null
    }
  ],
  "csrfToken": "..."
}
```
- Validations: closer must be **Approved+Active** (else **422**); every line's product/add-ons must be `Active`; **`sale_amount` must equal Σ line amounts** (server recomputes; mismatch → **422**); `amount_collected ≤ sale_amount` (else **422**); installment params valid when `payment_plan = Installment`. `company_id` defaults from each product's `default_company_id` if omitted.
- Each line resolves its own product/rates and **commission is computed per line** (§3.8). A multi-product sale may span company entities (here Enshrine Services + Enshrine Pets Paradise).

Response `201`:
```json
{
  "id": "sub_01H...",
  "status": "Submitted",
  "sale_amount": 10500.00,
  "payment_plan": "Installment",
  "closing_associate_id": "a_01HSELF",
  "line_items": [
    { "id": "li_01H...", "product_code": "FUN-BASE", "product_name": "Funeral System (Base)", "commission_type": "Percentage", "company_id": "co_01HENSHRINE", "line_sale_amount": 10000.00, "quantity": 1, "selected_com_codes": ["SCATTER"] },
    { "id": "li_02H...", "product_code": "PET-CREMATE", "product_name": "Pet Cremation Package", "commission_type": "Fixed", "company_id": "co_01HPETS", "line_sale_amount": 500.00, "quantity": 1, "selected_com_codes": [] }
  ]
}
```

### 3.5 Sales Verification → Transactions

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/sales/submissions/{id}/verify` | Admin, Accounts | global |
| `POST` | `/sales/submissions/{id}/reject` | Admin, Accounts | global |
| `GET` | `/sales/transactions` | Admin, Accounts (global); SD/SM (downline); Consultant (self) | scoped |
| `GET` | `/sales/transactions/{id}` | as above | scoped |

**`POST /sales/submissions/{id}/verify`** (promote → transaction, PRD §6.4) — request:
```json
{ "verified_com_codes": ["SCATTER"], "remarks": "Agreement + deposit confirmed.", "csrfToken": "..." }
```
On verify: assigns `transaction_code`, **snapshots the upline chain** (`direct_upline_id`, `second_upline_id`), resolves the **structure version per line item** by `sales_date`, computes `commission_eligibility`, and carries the submission's `line_items` onto the transaction (each line now has a `transaction_id` + resolved `structure_version_id`). Verifying an already-verified submission → **409**. Response `201`:
```json
{
  "id": "txn_01H...",
  "transaction_code": "TXN-2026-000142",
  "sales_date": "2026-06-25",
  "sale_amount": 10500.00,
  "payment_plan": "Installment",
  "closing_associate_id": "a_01HSELF",
  "direct_upline_id": "a_01HKOO",
  "second_upline_id": "a_01HSYLVIA",
  "commission_eligibility": "Pending Collection",
  "verified_by": "u_01HACCT",
  "verified_at": "2026-06-28T03:20:00Z",
  "line_items": [
    { "id": "li_01H...", "product_code": "FUN-BASE", "commission_type": "Percentage", "company_id": "co_01HENSHRINE", "line_sale_amount": 10000.00, "structure_version_id": "csv_01HFUN", "selected_com_codes": ["SCATTER"] },
    { "id": "li_02H...", "product_code": "PET-CREMATE", "commission_type": "Fixed", "company_id": "co_01HPETS", "line_sale_amount": 500.00, "structure_version_id": "csv_01HPET", "selected_com_codes": [] }
  ]
}
```
`commission_eligibility ∈ {Eligible, Pending Collection, Partially Eligible, Ineligible}`. **Invoicing:** transaction lines are grouped **by `company_id`** → one invoice per entity by default (here two invoices: Enshrine Services + Enshrine Pets Paradise), or one consolidated invoice (§3.6).

### 3.6 Invoices

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/invoices` | Admin, Accounts (global); SD/SM/Consultant (own sales) | scoped |
| `GET` | `/invoices` | Admin, Accounts (global); SD/SM/Consultant (own) | scoped |
| `GET` | `/invoices/outstanding` | Admin, Accounts (global); SD/SM/Consultant (own) | scoped |
| `GET` | `/invoices/{id}` | as above | scoped |
| `POST` | `/invoices/{id}/mark-paid` | Admin, Accounts | global |
| `GET` | `/invoices/{id}/pdf` | Admin, Accounts (global); owner (own) | scoped |
| `POST` | `/invoices/{id}/signature` | Admin, Accounts; owner (own) | scoped (upload signed PDF) |

**`POST /invoices`** (generate, PRD §6.5b/§7.7) — invoice generation **groups the transaction's line items by `company_id`** → **one invoice per entity by default** (a single-entity sale = one invoice), or a single **consolidated** invoice spanning entities (PRD §6.5b, default = per-entity). Each per-entity invoice's `amount` is the sum of that entity's line amounts. Request (one entity):
```json
{
  "transaction_id": "txn_01H...",
  "company_id": "co_01HENSHRINE",
  "invoice_type": "Computer-Generated",
  "installment_index": null,
  "amount": 10000.00,
  "consolidated": false,
  "csrfToken": "..."
}
```
- `invoice_type ∈ {Computer-Generated, Signature}`. Computer-Generated carries the footer "This is a computer-generated invoice; no signature required." Invoice number is allocated **atomically** from the company sequence: `INV-<PREFIX>-YYYY-#####`. For the multi-entity sale above, generation yields one `INV-EN-...` (Enshrine Services, $10,000) and one `INV-EPP-...` (Enshrine Pets Paradise, $500); set `consolidated: true` to instead bill all lines on a single invoice.
Response `201`:
```json
{
  "id": "inv_01H...",
  "transaction_id": "txn_01H...",
  "company_id": "co_01HENSHRINE",
  "invoice_number": "INV-EN-2026-00187",
  "invoice_type": "Computer-Generated",
  "installment_index": null,
  "amount": 10000.00,
  "status": "Outstanding",
  "pdf_file_key": "invoices/INV-EN-2026-00187.pdf"
}
```

**`GET /invoices/outstanding`** — response `200` (paginated list of `status = Outstanding`):
```json
{
  "data": [
    { "id": "inv_01H...", "invoice_number": "INV-EN-2026-00188", "transaction_id": "txn_01H...", "installment_index": 3, "amount": 1000.00, "status": "Outstanding", "client_name": "Mdm Goh" }
  ],
  "meta": { "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
}
```

**`POST /invoices/{id}/mark-paid`** (PRD §6.5b — feeds eligibility) — request: `{ "paid_date": "2026-09-01", "csrfToken": "..." }`. Flips invoice (and, for an installment invoice, the matching `installment_schedule` row) to `Paid`, then **triggers idempotent commission recompute** for the transaction (§3.9, §8.3). Marking an already-Paid/locked invoice → **409**. Response `200`:
```json
{ "id": "inv_01H...", "status": "Paid", "paid_date": "2026-09-01", "eligibility_recomputed": true }
```

**`POST /invoices/{id}/signature`** (signature flow, PRD §6.5b invoice type 2) — `multipart/form-data` with `signed_pdf`. Response `200`:
```json
{ "id": "inv_01H...", "invoice_type": "Signature", "signed_pdf_file_key": "invoices/signed/INV-EN-2026-00187.pdf" }
```

**`GET /invoices/{id}/pdf`** — returns `application/pdf` with the chosen company's stamp.

### 3.7 Installment Plans & Schedule

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/installment-plans` | Admin, Accounts; SD/SM/Consultant (own sales) | scoped |
| `GET` | `/installment-plans` | Admin, Accounts (global); SD/SM/Consultant (own) | scoped |
| `GET` | `/installment-plans/{id}` | as above | scoped |
| `PATCH` | `/installment-plans/{id}` | Admin, Accounts | global (adjust/renegotiate) |
| `GET` | `/installment-plans/{id}/schedule` | as above | scoped |

**`POST /installment-plans`** (auto-calc, PRD §6.5b/§7.8) — request:
```json
{ "transaction_id": "txn_01H...", "total_amount": 10000.00, "deposit": 1000.00, "installment_count": 9, "csrfToken": "..." }
```
Auto-calculates the balance, **pre-generates the schedule + one invoice per installment**. Formula: `installment = round((total − deposit) / n)` with residual on the final installment. Response `201`:
```json
{
  "id": "plan_01H...",
  "transaction_id": "txn_01H...",
  "total_amount": 10000.00,
  "deposit": 1000.00,
  "installment_count": 9,
  "status": "Active",
  "schedule": [
    { "sequence": 1, "due_amount": 1000.00, "due_date": "2026-07-01", "invoice_id": "inv_s1", "paid": false },
    { "sequence": 2, "due_amount": 1000.00, "due_date": "2026-08-01", "invoice_id": "inv_s2", "paid": false },
    { "sequence": 9, "due_amount": 1000.00, "due_date": "2027-03-01", "invoice_id": "inv_s9", "paid": false }
  ]
}
```
Schedule installments must sum to `total − deposit` (else **422**).

**`PATCH /installment-plans/{id}`** (adjust/renegotiate, PRD §6.5b) — request:
```json
{
  "adjustable_amount": 600.00,
  "new_schedule": [
    { "sequence": 4, "due_amount": 600.00, "due_date": "2026-10-01" },
    { "sequence": 5, "due_amount": 600.00, "due_date": "2026-11-01" },
    { "sequence": 6, "due_amount": 400.00, "due_date": "2026-12-01" }
  ],
  "remarks": "Renegotiated remaining balance.",
  "csrfToken": "..."
}
```
**Previously-paid installments are preserved**; only the remaining schedule recomputes. Response `200` returns the updated plan + schedule.

### 3.8 Commission Engine

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/commission/run` | Admin, Accounts | global (idempotent) |
| `POST` | `/transactions/{id}/commission/override` | Admin | global (manual override line) |

**`POST /commission/run`** (PRD §6.6/§8.1) — idempotent; pass `Idempotency-Key` header. Request:
```json
{ "scope": "transaction", "transaction_id": "txn_01H...", "csrfToken": "..." }
```
or batch:
```json
{ "scope": "month", "payout_month": "2026-09", "csrfToken": "..." }
```
Deletes + re-inserts ledger lines per affected transaction (no duplicates). The engine runs **per line item** and sums: each ledger line carries a `line_item_id` (which product line it came from), so a **multi-line sale yields ledger lines per item**. A `Fixed`-type line starts from `closing_comm_fixed` (not sale × pct) and then applies the identical pool/override split. Response `200`:
```json
{
  "run_id": "run_01H...",
  "transactions_processed": 1,
  "ledger_lines_written": 8,
  "reconciled": true,
  "lines": [
    { "line_item_id": "li_01H...", "line_type": "Personal", "associate_id": "a_01HSELF", "basis_amount": 1000.00, "amount": 600.00 },
    { "line_item_id": "li_01H...", "line_type": "Override", "associate_id": "a_01HKOO", "rate_or_value": 20, "basis_amount": 400.00, "amount": 80.00 },
    { "line_item_id": "li_01H...", "line_type": "Override", "associate_id": "a_01HSYLVIA", "rate_or_value": 10, "basis_amount": 400.00, "amount": 40.00 },
    { "line_item_id": "li_01H...", "line_type": "Company Retained", "associate_id": null, "amount": 280.00 },
    { "line_item_id": "li_02H...", "line_type": "Personal", "associate_id": "a_01HSELF", "basis_amount": 500.00, "amount": 300.00 },
    { "line_item_id": "li_02H...", "line_type": "Override", "associate_id": "a_01HKOO", "rate_or_value": 20, "basis_amount": 200.00, "amount": 40.00 },
    { "line_item_id": "li_02H...", "line_type": "Override", "associate_id": "a_01HSYLVIA", "rate_or_value": 10, "basis_amount": 200.00, "amount": 20.00 },
    { "line_item_id": "li_02H...", "line_type": "Company Retained", "associate_id": null, "amount": 140.00 }
  ]
}
```
Line `li_01H` is the §8.2 **Percentage** worked example (closer $600, SM $80, SD $40, retained $280 → ties to $1,000); line `li_02H` is the **Fixed**-type example (`closing_comm_fixed = $500` → pool $200, closer $300, SM $40, SD $20, retained $140 → ties to $500). Add-on lines (`line_type: "Add-on"`) and `External Payable` lines append per line where applicable. Lines stay `Pending` until the eligibility milestone (default 3rd installment paid) is met.

**`POST /transactions/{id}/commission/override`** (manual override, PRD §6.5/§8.6 — Admin only, RBAC) — request:
```json
{
  "associate_id": "a_01HKOO",
  "line_type": "Override",
  "amount": 120.00,
  "override_reason": "Complex cascade upgrade; manual per client.",
  "csrfToken": "..."
}
```
Supersedes the computed value; flagged `is_manual_override: true`, audit-logged, reconciliation assertion relaxed for that line. Response `200`:
```json
{ "ledger_id": "led_01H...", "is_manual_override": true, "amount": 120.00, "override_reason": "Complex cascade upgrade; manual per client." }
```

### 3.9 Commission Ledger

| Method | Path | Role | Scope |
|---|---|---|---|
| `GET` | `/commission/ledger` | Admin, Accounts (global); SD/SM (downline); Consultant (self) | scoped |
| `GET` | `/commission/ledger/{id}` | as above | scoped |

**`GET /commission/ledger?payout_month=2026-09&associate_id=a_01HSELF`** — response `200`:
```json
{
  "data": [
    {
      "id": "led_01H...",
      "transaction_id": "txn_01H...",
      "line_item_id": "li_01H...",
      "payout_month": "2026-09",
      "associate_id": "a_01HSELF",
      "associate_name": "Tan Wei Ming",
      "designation": "Sales Consultant",
      "line_type": "Personal",
      "com_code": null,
      "basis_amount": 1000.00,
      "rate_or_value": 60,
      "amount": 600.00,
      "is_manual_override": false,
      "eligibility": "Eligible",
      "status": "Eligible"
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
}
```
A Consultant requesting another associate's ledger → **403** `code: OUT_OF_SCOPE` (RBAC §6). `line_type ∈ {Personal, Override, Add-on, Company Retained, External Payable}`; `status ∈ {Pending, Eligible, Paid, Cancelled}`.

### 3.10 Monthly Payouts

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/payouts/run` | Admin, Accounts | global |
| `GET` | `/payouts` | Admin, Accounts (global); SD/SM (downline+self); Consultant (self) | scoped |
| `GET` | `/payouts/{id}` | as above | scoped |
| `POST` | `/payouts/{id}/approve` | Admin, Accounts | global |
| `POST` | `/payouts/{id}/mark-paid` | Admin, Accounts | global |
| `GET` | `/payouts/{id}/statement.pdf` | Admin, Accounts (global); owner (self) | scoped |

**`POST /payouts/run`** (generate, PRD §6.8/§7.10) — aggregates eligible ledger lines per associate per month. `Idempotency-Key` supported. Request: `{ "payout_month": "2026-09", "csrfToken": "..." }`. Response `200`:
```json
{
  "payout_month": "2026-09",
  "payouts_generated": 12,
  "data": [
    {
      "id": "pay_01H...",
      "associate_id": "a_01HSELF",
      "associate_name": "Tan Wei Ming",
      "designation": "Sales Consultant",
      "personal_commission": 600.00,
      "override_commission": 0.00,
      "addon_commission": 200.00,
      "total_payable": 800.00,
      "payout_status": "Pending"
    }
  ]
}
```
`total_payable = personal_commission + override_commission + addon_commission`; only `Eligible` lines roll in. Unique per `(associate_id, payout_month)`.

**`POST /payouts/{id}/approve`** — request: `{ "csrfToken": "..." }`. Pending → Approved. Response `200`: `{ "id": "pay_01H...", "payout_status": "Approved" }`.

**`POST /payouts/{id}/mark-paid`** — request: `{ "paid_date": "2026-10-05", "csrfToken": "..." }`. Approved → Paid; stamps `paid_date` and **locks** the row. Re-marking a Paid/Cancelled row → **409**. Response `200`:
```json
{ "id": "pay_01H...", "payout_status": "Paid", "paid_date": "2026-10-05", "locked": true }
```
`payout_status ∈ {Pending, Approved, Paid, Cancelled}`.

### 3.11 Bank File (GIRO)

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/bank-file` | Admin, Accounts | global |
| `GET` | `/bank-file` | Admin, Accounts | global |
| `GET` | `/bank-file/{batchId}/download` | Admin, Accounts | global |

**`POST /bank-file`** (PRD §6.8 — associate payout only) — request:
```json
{ "payout_month": "2026-09", "payout_ids": ["pay_01H...", "pay_02H..."], "format": "GIRO", "csrfToken": "..." }
```
Produces a GIRO/bank text file (and CSV) covering the selected payouts; links them via `bank_file_batch_id`. Response `201`:
```json
{
  "id": "batch_01H...",
  "payout_month": "2026-09",
  "status": "Generated",
  "file_key": "bank-files/2026-09/giro-batch-01.txt",
  "payout_count": 2,
  "total_amount": 1400.00,
  "download_url": "https://files.../signed-url?..."
}
```
`status ∈ {Generated, Uploaded, Reconciled}`. The file matches the selected payouts exactly (acceptance criterion, PRD §6.8). `GET /bank-file/{batchId}/download` returns the file with `Content-Disposition: attachment`.

### 3.12 Dashboards

| Method | Path | Role | Scope |
|---|---|---|---|
| `GET` | `/dashboard/personal` | all authenticated associates | self |
| `GET` | `/dashboard/team` | SalesManager, SalesDirector | downline |
| `GET` | `/dashboard/director` | SalesDirector | full downline |
| `GET` | `/dashboard/admin` | Admin, Accounts | global |

All dashboard reads are filtered to the caller's downline closure (recursive CTE); cross-scope → **403** (PRD §6.9, RBAC §2).

**`GET /dashboard/personal`** — response `200` (tile metrics, PRD §6.9):
```json
{
  "scope": "self",
  "tiles": {
    "monthly_sales": 24000.00,
    "ytd_sales": 156000.00,
    "commission_earned": 1440.00,
    "override_commission": 0.00,
    "pending_commission": 800.00,
    "paid_commission": 640.00,
    "team_ranking": null
  },
  "recruitment": { "new_recruits": 0, "approval_pending": 0, "team_growth": 0 }
}
```

**`GET /dashboard/team`** (SM/SD) — response `200`:
```json
{
  "scope": "downline",
  "tiles": {
    "monthly_sales": 88000.00,
    "ytd_sales": 612000.00,
    "team_target": 100000.00,
    "team_achievement_pct": 88.0,
    "commission_earned": 5200.00,
    "override_commission": 1280.00,
    "team_ranking": 2
  },
  "team": [
    {
      "associate_id": "a_01HSELF",
      "full_name": "Tan Wei Ming",
      "sales_this_month": 24000.00,
      "cases_closed": 3,
      "cases_pending": 1,
      "collection_status": "Pending Collection",
      "last_sale_date": "2026-06-25",
      "active": true
    }
  ]
}
```

**`GET /dashboard/admin`** — global tiles plus org-wide rollups (total sales, outstanding invoices, pending verifications, pending payouts). Same tile vocabulary, `scope: "global"`.

### 3.13 Notices

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/notices` | Admin, Accounts | global |
| `GET` | `/notices` | all authenticated | audience-scoped (home feed) |
| `GET` | `/notices/{id}` | all authenticated | audience-scoped |
| `POST` | `/notices/{id}/read` | all authenticated | self |

**`POST /notices`** (PRD §6.10/§7.11) — `multipart/form-data` or JSON:
```json
{ "title": "Commission clause update", "body": "Effective 1 Jul, SM override is 15%.", "audience": "All", "csrfToken": "..." }
```
Optional `attachment` file field. `audience ∈ {All, Team, Role}`. Delivered in-app (bell + count) **and** by email (§9). Response `201`:
```json
{ "id": "not_01H...", "title": "Commission clause update", "audience": "All", "published_at": "2026-06-28T01:00:00Z" }
```

**`GET /notices`** — paginated home-feed list, newest first. Each row includes `read` (per-caller). **`POST /notices/{id}/read`** records `notice_reads(notice_id, user_id, read_at)`; response `200`: `{ "id": "not_01H...", "read": true }`.

### 3.14 Documents

| Method | Path | Role | Scope |
|---|---|---|---|
| `GET` | `/documents` | all authenticated | visibility-scoped |
| `POST` | `/documents` | Admin, Accounts (templates + assigned agreements); self (own signed docs) | scoped |
| `GET` | `/documents/sales-agreements` | all authenticated associates | self (targeted to caller) |
| `GET` | `/documents/{id}/download` | per `visibility` / `assignment` | scoped |

**`GET /documents?type=Company Template`** (PRD §6.11/§7.12) — response `200`:
```json
{
  "data": [
    { "id": "doc_01H...", "type": "Company Template", "title": "Referred (Marketing) Partnership Agreement", "visibility": "All", "owner_associate_id": null },
    { "id": "doc_02H...", "type": "Associate Agreement", "title": "My Signed Associate Agreement", "visibility": "Owner", "owner_associate_id": "a_01HSELF" }
  ],
  "meta": { "page": 1, "pageSize": 20, "totalItems": 2, "totalPages": 1 }
}
```
`type ∈ {Company Template, Associate Agreement, Vendor Agreement, Vendor MOU, Sales Agreement, Other}`; `assignment ∈ {All, Team, Associate}`; `visibility ∈ {All, Owner, Admin}`.

**`POST /documents`** (upload + assignment, PRD §6.11/§7.12) — `multipart/form-data`: `file`, plus `type`, `title`, `assignment`, `visibility`, optional `assigned_team`, `assigned_associate_id`, `owner_associate_id`. For Sales Agreements, set `type` to `Vendor MOU` or `Sales Agreement` and `assignment` to `All` / `Team` (with `assigned_team`) / `Associate` (with `assigned_associate_id`). Only Admin/Accounts may upload/assign vendor MOUs / sales agreements. Request:
```json
{ "type": "Vendor MOU", "title": "Happy Paws Grooming MOU", "assignment": "Associate", "assigned_associate_id": "a_01HSELF", "visibility": "Owner", "csrfToken": "..." }
```
Response `201` returns the document record:
```json
{ "id": "doc_03H...", "type": "Vendor MOU", "title": "Happy Paws Grooming MOU", "assignment": "Associate", "assigned_associate_id": "a_01HSELF", "file_key": "documents/vendor-mou/doc_03H.pdf" }
```

**`GET /documents/sales-agreements`** (PRD §6.11 — the Sales Agreements tab) — returns `Vendor MOU` / `Sales Agreement` documents **targeted to the caller** (by `assignment = All`, their `Team`, or themselves). Associates have **download-only**. Response `200`:
```json
{
  "data": [
    { "id": "doc_03H...", "type": "Vendor MOU", "title": "Happy Paws Grooming MOU", "assignment": "Associate", "assigned_associate_id": "a_01HSELF" },
    { "id": "doc_04H...", "type": "Sales Agreement", "title": "Q3 Vendor Sales Agreement", "assignment": "Team", "assigned_team": "Vincent Lim Division" }
  ],
  "meta": { "page": 1, "pageSize": 20, "totalItems": 2, "totalPages": 1 }
}
```
Non-targeted associates do not see the document; requesting a non-targeted doc → **403**.

**`GET /documents/{id}/download`** returns the file via signed URL / streamed download; an associate may download `All`-visibility templates, their own `Owner` docs, and sales agreements targeted to them. Out-of-scope → **403**.

### 3.14a Name Card / VCF

> Digital name card auto-populated from the user/associate profile + company entity (PRD §6.14, schema §7.12a). Users view/download **their own** card; Admin can view all. Card data is mostly **derived** and updates automatically when the profile changes.

| Method | Path | Role | Scope |
|---|---|---|---|
| `GET` | `/me/name-card` | all authenticated | self (view data) |
| `GET` | `/me/name-card.vcf` | all authenticated | self (download vCard) |
| `GET` | `/me/name-card.png` | all authenticated | self (rendered card) |
| `GET` | `/me/name-card.pdf` | all authenticated | self (rendered card) |
| `GET` | `/associates/{id}/name-card` | Admin | global (view any) |
| `GET` | `/associates/{id}/name-card.vcf` | Admin | global |
| `GET` | `/associates/{id}/name-card.png` · `.pdf` | Admin | global |

**`GET /me/name-card`** — response `200` (card data, derived from current profile):
```json
{
  "full_name": "Tan Wei Ming",
  "chinese_name": "陈伟明",
  "title": "Funeral Director",
  "mobile_number": "98765432",
  "email": "tan@example.com",
  "company": "Enshrine Services Pte Ltd",
  "address": "74 Lorong 6 Geylang, Singapore 399226",
  "web": "enshrine.sg",
  "qr_payload": "BEGIN:VCARD...",
  "photo_url": "https://files.../signed-url?..."
}
```

**`GET /me/name-card.vcf`** — returns `text/vcard` (`Content-Disposition: attachment`); a valid vCard 3.0/4.0 with `FN, N, TITLE, ORG, TEL, EMAIL, ADR, URL, PHOTO` that imports cleanly into a phone contact app.

**`GET /me/name-card.png`** / **`.pdf`** — returns the rendered card (`image/png` / `application/pdf`) in the Enshrine business-card template.

**`GET /associates/{id}/name-card.*`** — Admin-only equivalents to view/download any user's card; non-Admin → **403**.

### 3.15 Vendor Referrals

| Method | Path | Role | Scope |
|---|---|---|---|
| `POST` | `/vendor-referrals` | all authenticated associates | own (submit) |
| `GET` | `/vendor-referrals` | all authenticated | global (view-only directory) |
| `GET` | `/vendor-referrals/{id}` | all authenticated | global (read) |
| `PATCH` | `/vendor-referrals/{id}` | Admin, Accounts | global (edit only) |

**`POST /vendor-referrals`** (Referred Partnership Registration, PRD §6.13/§7.13) — `multipart/form-data`:
```json
{
  "vendor_name": "Happy Paws Grooming",
  "vendor_type": "Groomer",
  "contact": "Jane / 81234567",
  "remarks": "Referral tie-up, Bukit Timah.",
  "csrfToken": "..."
}
```
plus `agreement` file. Server stamps `submitted_at` (the **first-claim timestamp**). Response `201`:
```json
{
  "id": "ven_01H...",
  "vendor_name": "Happy Paws Grooming",
  "vendor_type": "Groomer",
  "submitted_by_associate_id": "a_01HSELF",
  "submitted_at": "2026-06-28T05:42:11Z",
  "status": "Active"
}
```
The directory (`GET /vendor-referrals`) is **view-only** to associates; only Admin/Accounts may `PATCH`. `status ∈ {Active, Lapsed}`.

### 3.16 Audit Log

| Method | Path | Role | Scope |
|---|---|---|---|
| `GET` | `/audit-log` | Admin | global |
| `GET` | `/audit-log/{id}` | Admin | global |

**`GET /audit-log?entity_type=sales_transactions&from=2026-06-01`** (PRD §7.14, append-only) — response `200`:
```json
{
  "data": [
    {
      "id": "aud_01H...",
      "actor_user_id": "u_01HACCT",
      "action": "VERIFY_SUBMISSION",
      "entity_type": "sales_transactions",
      "entity_id": "txn_01H...",
      "before_json": { "status": "Submitted" },
      "after_json": { "transaction_code": "TXN-2026-000142", "commission_eligibility": "Pending Collection" },
      "created_at": "2026-06-28T03:20:00Z"
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
}
```
Accounts/SD/SM/Consultant → **403**.

---

## 4. Endpoint × Role quick-reference

Legend: ✅ allowed (global) · 🔵 scoped to downline · 🟡 own/self only · ❌ denied.

| Endpoint | Admin | Accounts | SalesDirector | SalesManager | Consultant |
|---|---|---|---|---|---|
| `POST /recruitment/applications` | ✅ | ✅ | public | public | public |
| `GET /recruitment/applications` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /candidates` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /candidates` · `/candidates/{id}` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET`/`POST /onboarding/{token}` · `/sign` | public | public | public | public | public |
| `POST /candidates/{id}/approve` · `/reject` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /associates/{id}/pfile` | ✅ | ✅ | 🟡 own | 🟡 own | 🟡 own |
| `POST /associates/{id}/pfile` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /pfile-documents/{id}/download` | ✅ | ✅ | 🟡 own | 🟡 own | 🟡 own |
| `GET /me/name-card`, `.vcf`, `.png`, `.pdf` | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| `GET /associates/{id}/name-card.*` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /associates` | ✅ | ✅ | 🔵 | 🔵 | 🟡 |
| `PATCH /associates/{id}` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /associates/{id}/approve` · `/reject` · `/status` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /associates/{id}/photo` | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| `GET /associates/contacts.csv` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /companies` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST`/`PATCH /companies` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /products` · `/com-codes` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST`/`PATCH /products`, `/rate-change`, `/com-codes` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /sales/submissions` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /sales/submissions` · `/transactions` | ✅ | ✅ | 🔵 | 🔵 | 🟡 |
| `POST /sales/submissions/{id}/verify` · `/reject` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /invoices` | ✅ | ✅ | 🔵 own | 🔵 own | 🟡 own |
| `GET /invoices` · `/outstanding` | ✅ | ✅ | 🔵 own | 🔵 own | 🟡 own |
| `POST /invoices/{id}/mark-paid` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /installment-plans` | ✅ | ✅ | 🔵 own | 🔵 own | 🟡 own |
| `PATCH /installment-plans/{id}` (adjust) | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /commission/run` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /transactions/{id}/commission/override` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /commission/ledger` | ✅ | ✅ | 🔵 | 🔵 | 🟡 |
| `POST /payouts/run` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /payouts` | ✅ | ✅ | 🔵+self | 🔵+self | 🟡 |
| `POST /payouts/{id}/approve` · `/mark-paid` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST`/`GET /bank-file` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /dashboard/personal` | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| `GET /dashboard/team` | ✅ | ✅ | 🔵 | 🔵 | ❌ |
| `GET /dashboard/director` | ✅ | ✅ | 🔵 | ❌ | ❌ |
| `GET /dashboard/admin` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST /notices` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /notices`, `POST /notices/{id}/read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /documents`, `/download` | ✅ | ✅ | 🔵 | 🔵 | 🟡 |
| `GET /documents/sales-agreements` | ✅ | ✅ | 🟡 | 🟡 | 🟡 |
| `POST /documents` | ✅ | ✅ | 🟡 own | 🟡 own | 🟡 own |
| `POST /vendor-referrals` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /vendor-referrals` | ✅ | ✅ | view | view | view |
| `PATCH /vendor-referrals/{id}` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /audit-log` | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 5. Webhooks & integration notes

### 5.1 Email (transactional)
- The system sends **transactional email** only (PRD §11): recruitment-approval, notice broadcast, payout-paid notification, password reset, e-sign request links. Associates email clients from their own mailbox; the portal does not send marketing mail.
- Suggested provider abstraction: a single `EmailService.send({ to, template, data })`. Templates: `recruitment_approved`, `notice_published`, `payout_paid`, `password_reset`, `invoice_sign_request`.
- **Inbound delivery webhooks (optional):** if using a provider (e.g. Postmark/SES), expose `POST /webhooks/email` to record bounces/complaints. Verify the provider signature; reject unsigned → **403**. This endpoint is provider-to-server (not part of the first-party RBAC surface).

### 5.2 File storage & signed URLs
- All file fields store an **object key only** (e.g. `agreement_file_key`, `pdf_file_key`, `statement_file_key`, `file_key`); files live in S3-compatible storage in `ap-southeast-1` (PRD §4, §10).
- Download endpoints (`/invoices/{id}/pdf`, `/payouts/{id}/statement.pdf`, `/documents/{id}/download`, `/bank-file/{batchId}/download`, agreement sign URLs) issue **short-lived signed URLs** (default TTL 5 min) rather than streaming through the app, or stream with the same authorization check applied first. Access to a key is authorized against RBAC scope before any URL is minted.
- Uploads use `multipart/form-data` to the relevant `POST`; the server validates content-type/size and returns the stored key.

### 5.3 Deferred payment gateway (placeholder)
- v1 has **no payment gateway** (PRD §1.3); installment payments are recorded **manually** via `POST /invoices/{id}/mark-paid`, which is the authoritative eligibility trigger.
- A future gateway (Stripe/HitPay/RedDot) would integrate via `POST /webhooks/payments` calling the **same internal "mark paid" service** that `mark-paid` uses — so eligibility recompute and idempotency are preserved. Reserve the route and a `payment_reference` field; leave a clearly-commented seam (PRD §0). The webhook must verify the provider signature and be idempotent on the provider event ID.

---

## 6. Server actions vs REST (Next.js note)

Per PRD §4, the backend is **Next.js server actions / route handlers**. In practice:

- **Server actions** are the natural fit for **form-driven mutations** invoked from React Server Components — e.g. recruitment submit, sales submit, invoice mark-paid, notice post, vendor-referral submit, payout approve/mark-paid. These run server-side, resolve the principal from the session, and call the same `can(principal, action, resource)` policy layer (RBAC §4) before touching data. Next.js server actions carry **built-in CSRF protection** (origin checks), satisfying §1.2 for action-based mutations.
- **Route handlers (`app/api/v1/.../route.ts`)** are used where a true HTTP contract is needed: **file downloads** (PDF, CSV, GIRO file), the **CSV/contacts export**, **webhooks** (email/payments), and any endpoint consumed by non-React clients or background/cron jobs (commission run, payout run, bank-file generation can be triggered by a scheduled runner — PRD §4).
- Regardless of transport, the **authorization, scoping, validation, status semantics, and audit-logging** described here are normative. The endpoint table is the single source of truth for the system surface even where the literal implementation is a server action rather than a fetchable URL.

---

*End of API Documentation v1.0.*
