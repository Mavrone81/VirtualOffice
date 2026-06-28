# Security & PDPA Compliance — Enshrine Associate Management Portal

**Version:** 1.0 · **Source of truth:** `Enshrine_Portal_PRD.md` v1.2 (§4, §9, §10) · **Canonical references:** `05_RBAC.md` (roles, scoping), `02_Database_Diagram.md` (entities, encrypted columns)
**Scope:** Singapore PDPA compliance + application security for a single-tenant CRM + HRMS handling associate PII and commission/payout finances.
**Stack context:** Next.js (App Router, TypeScript), PostgreSQL + Prisma, NextAuth/Auth.js, S3-compatible storage, Vercel + managed Postgres in **ap-southeast-1 (Singapore)**.

---

## 1. Data classification

All data in the portal is classified into four tiers. Handling rules (encryption, masking, access, logging) follow from the tier.

| Tier | Examples (columns / entities) | Handling |
|---|---|---|
| **C3 — Restricted PII** | `associates.nric`, `associates.bank_account_number` | Encrypted at rest (column-level), masked in UI, decrypt only for `Admin`/`Accounts`, every access audit-logged. |
| **C2 — Sensitive PII** | `associates.date_of_birth`, `associates.paynow_number`, `associates.mobile_number`, `associates.email`, `associates.full_name`, `client_name`, `client_contact` | TLS in transit; access scoped per RBAC; not exposed cross-scope. |
| **C2-F — Financial** | `commission_ledger.amount`, `monthly_payouts.*`, `invoices.amount`, `installment_schedule.due_amount`, override/payout figures, `bank_file_batches` | Scoped per RBAC downline closure; manual-only money movement (§9); audit-logged on status changes. |
| **C1 — Internal** | products, com codes, commission rates, notices, vendor referrals, documents metadata | RBAC-gated; no special encryption beyond at-rest disk encryption. |
| **C0 — Public** | brand names (Enshrine, Trust Pets), product category labels | None. |

**PII inventory (PDPA "personal data"):** NRIC, full name, business name, DOB, mobile, email, residential/PayNow identifiers, bank name + account number, photo (`photo_file_key`), signed agreement, and customer fields (`client_name`, `client_contact`). NRIC and bank account number are the highest-risk items and are treated as C3 throughout.

---

## 2. Encryption

### 2.1 At rest
- **Column-level encryption** for C3 fields: `associates.nric`, `associates.bank_account_number`, and the mirrored `monthly_payouts.bank_account_number`. Use authenticated encryption (AES-256-GCM) via a single app-level data key; ciphertext stored in the existing `text` columns (per `02_Database_Diagram.md`). The key is held in `ENCRYPTION_KEY` (see §11), never in the database.
- **Disk/volume encryption** on the managed Postgres instance (provider default for RDS/Neon/Supabase in ap-southeast-1) covers all other tiers at rest.
- **Object storage** (S3-compatible) encrypted at rest (SSE); files referenced only by `*_file_key` columns, never public-bucket.

### 2.2 In transit
- **TLS 1.2+** enforced end to end: browser ↔ Vercel edge, app ↔ Postgres (`sslmode=require`), app ↔ object storage, app ↔ email provider.
- HSTS header on all responses; secure cookies only (§4.4).

### 2.3 Hashing
- Passwords (`users.password_hash`) hashed with **argon2id** (or bcrypt cost ≥ 12) — never reversible. Distinct from C3 encryption (which must be decryptable for payout files).

---

## 3. Masking rules

Masking is enforced **server-side**, not by hiding UI (per `05_RBAC.md` §4.5). The serializer strips/masks before the payload leaves the server.

| Field | Admin / Accounts | SD / SM / Consultant (incl. owning associate by default) |
|---|---|---|
| `nric` | Full (decrypted, access-logged) | Masked: `S****892A` (first char + last 4) |
| `bank_account_number` | Full (decrypted, access-logged) | Masked: last 4 only `••••3210` |
| `date_of_birth` | Full | Masked to year or hidden in cross-scope views |
| `paynow_number` / `mobile_number` | Full | Last 3 digits in cross-scope lists |

The bank account / NRIC are decrypted **only** at two trust points: (1) the payout/bank-GIRO-file generator (`Admin`/`Accounts`), and (2) the Admin/Accounts HR detail screen. Both decryptions write an `audit_log` entry (`action = "decrypt_pii"`, entity = associate).

---

## 4. Access control & application security

Access control is defined canonically in `05_RBAC.md`. This document references, not redefines, it.

### 4.1 Authorization model
- Roles (`app_role`): `Admin`, `Accounts`, `SalesDirector`, `SalesManager`, `Consultant`.
- **Downline-closure scoping** via recursive CTE on `direct_upline_id` (RBAC §2). Out-of-scope access returns **403**, never an empty 200 that leaks existence.
- **Gating overlay:** only `approval_status = Approved` AND `associate_status = Active` associates may be a closer, receive payouts, appear in Contacts export, or in manager dashboards.
- **Default deny:** any action not explicitly granted is denied.

### 4.2 IDOR / authorization (the primary threat)
The dominant risk in this app is **horizontal privilege escalation** — an SM/Consultant reading another associate's ledger, payout, NRIC, or sale.
- Every scoped repository method **requires a principal** and injects the downline-closure (or self) predicate at the query layer — it must be impossible to construct an unscoped query.
- Object-by-ID routes (`/sales/:id`, `/invoices/:id`, ledger lines) re-resolve ownership against the principal's scope before returning; mismatch → 403.
- Mutations re-check `can(principal, action, resource)` server-side; client role claims are never trusted.

### 4.3 Injection
- All DB access through **Prisma** (parameterised queries) — no string-built SQL. The one raw construct (downline recursive CTE) uses **parameterised** `$queryRaw` with bound `:current_associate_id`, never interpolation.
- Input validated with **zod** at every server action / route handler boundary (see `11_Coding_Standards.md`).

### 4.4 CSRF & session
- NextAuth/Auth.js session cookies: `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict` for state-changing flows).
- All mutating server actions are POST and origin-checked; Auth.js CSRF token on credential flows.
- Short session lifetime + idle timeout for Admin/Accounts; re-auth before bulk payout/bank-file generation.

### 4.5 File-upload validation
File uploads (agreements, signed PDFs, invoices, photos) per PRD §11:
- Validate MIME + magic bytes (allow `application/pdf`, `image/png|jpeg` only); reject mismatched extension.
- Size cap; filename sanitised; store under a generated `*_file_key`, never user-supplied path.
- Files are **private**; served exclusively via **time-limited signed URLs** (short TTL), scoped to the requesting principal. No public-read buckets.
- Optional malware scan hook before persistence.

### 4.6 Rate limiting
- Login / password-reset / e-sign endpoints rate-limited per IP + per account (lockout after N failures).
- Bulk endpoints (commission run, payout run, bank-file export, Contacts export) rate-limited and Admin/Accounts-only.

---

## 5. Consent capture at recruitment (PDPA)

PDPA requires **consent, notification of purpose, and reasonable purpose** at collection.
- The **Recruitment Form** (PRD §6.1) presents a PDPA consent notice stating the purposes: HR record-keeping, commission/payout processing, GIRO bank payout, and statutory needs.
- Consent is captured as an explicit checkbox + recorded in the **Associate Agreement** the applicant e-signs; the signed PDF (`signed_agreement_file_key`) is the durable consent record.
- Consent metadata (timestamp, version of notice, purposes) is written to `audit_log` at submission.
- Customer PII (`client_name`, `client_contact`) is collected for the funeral/aftercare service; purpose limited to fulfilment and invoicing.

---

## 6. Data residency

- All personal data is stored and processed in **Singapore (ap-southeast-1)**: managed Postgres, object storage, and (where configurable) Vercel function region.
- Backups, replicas, and logs are constrained to the Singapore region.
- No transfer of PII to a jurisdiction without comparable protection (PDPA Transfer Limitation). Any third-party processor (email provider, object storage, future payment gateway) must offer SG-region processing or an adequate-protection contractual safeguard before adoption.

---

## 7. Retention & deletion

- **Soft-delete only** in normal operation: `archived_at timestamptz` (PRD §4, DB conventions). No routine hard deletes; financial/commission history is immutable for audit and dispute resolution.
- **Retention policy:**
  - Financial records (transactions, ledger, invoices, payouts, bank batches): retained per accounting/tax obligation (≥ 5 years recommended for SG bookkeeping), then eligible for purge.
  - Associate PII: retained while active + a defined tail after termination, then minimised.
  - Customer PII: retained only as long as needed for the service + dispute window.
- **Purge job:** a scheduled, Admin-triggered purge permanently removes/anonymises records past retention. Purge is itself audit-logged (counts, criteria, actor) — the audit entry survives the purge.

---

## 8. Right to access / right to erasure (PDPA Access & Correction)

- **Access request:** an associate may request their personal data. Admin/Accounts exports the associate's record (associate master fields decrypted for the data subject, plus their signed agreement). Fulfil within the statutory response window; log the request and fulfilment in `audit_log`.
- **Correction:** associates request corrections via Admin/Accounts; edits are audit-logged with before/after.
- **Erasure / withdrawal of consent:** because commission history must be retained for finance/tax, erasure is handled as **anonymisation** — C3/C2 PII is cleared or pseudonymised while immutable financial ledger lines are kept under a non-identifying key. The request, decision, and action are audit-logged.
- A documented internal SOP names the **PDPA / Data Protection Officer** (Enshrine ops / Samuel in v1) as the point of contact for access/erasure requests.

---

## 9. Financial-action guardrails

The portal **never moves money automatically** (PRD §1.3, §6.8, business rule 9).
- **No payment gateway in v1** — gateways deferred; all payments recorded **manually** via "Mark as Paid".
- **Manual payout marking:** payout status workflow `Pending → Approved → Paid` is operator-driven (`Admin`/`Accounts` only). Marking `Paid` stamps `paid_date` and **locks the row** (business rule 14).
- **Bank GIRO file is an export, not a transfer:** the portal generates the GIRO/CSV file for the operator to upload to the bank manually. It pays **associate salary/commission only** — vendor/supplier payments are out of scope (future LMS).
- **Manual commission override** (`commission_ledger.is_manual_override`) is `Admin`-only, requires `override_reason`, and is audit-logged (RBAC §3, §6).
- Deferred gateway: when introduced, it must be SG-region, PCI-handled by the provider (no card data stored by the portal), and gated behind the same Approve→Paid workflow.

---

## 10. Audit logging

- Append-only `audit_log` (DB §2): `actor_user_id`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `created_at`.
- **Logged events (PRD §4, RBAC §3.6):** recruitment approve/reject, sale verify, commission run, manual override, rate/structure version change, invoice/installment mark-paid, payout status change, bank-file generation, PII decryption (`decrypt_pii`), consent capture, access/erasure/purge requests, role/user changes, failed-auth lockouts.
- Audit entries are immutable and survive soft-delete and purge; reviewed periodically for anomalous access.

---

## 11. Secrets handling

- Secrets (`DATABASE_URL`, `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, S3 keys, SMTP creds) stored in **Vercel encrypted environment variables**, per environment (local/staging/prod) — never committed. Local dev uses `.env.local` (git-ignored); see `10_Deployment_Runbook.md` §7 and `11_Coding_Standards.md`.
- `ENCRYPTION_KEY` is a high-value secret separate from DB credentials so a DB leak does not expose C3 plaintext.
- Key rotation procedure: introduce new key version, re-encrypt C3 columns in a migration, retire old key. Rotate `NEXTAUTH_SECRET` and storage keys on suspected compromise.
- Least-privilege service credentials (scoped storage IAM, DB role without superuser for the app).

---

## 12. OWASP-style threat checklist

| # | Threat | Mitigation in this app | Verified by |
|---|---|---|---|
| 1 | **Broken access control / IDOR** (read another's ledger/PII) | Server-side downline-closure scoping; principal-required repositories; 403 on out-of-scope; object-ownership re-check | RBAC §6 + permission tests (`09_Test_Plan.md`) |
| 2 | **Privilege escalation** (tampered role) | Server re-checks `can(...)`; role derived from session, not client | RBAC §6 test |
| 3 | **Injection (SQL)** | Prisma parameterised; CTE via bound `$queryRaw` | Code review + tests |
| 4 | **Injection (input)** | zod validation at every boundary | Unit/integration tests |
| 5 | **CSRF** | SameSite cookies, POST + origin check, Auth.js CSRF token | Manual + e2e |
| 6 | **Broken auth / session** | argon2id passwords, HttpOnly+Secure cookies, idle timeout, rate-limit/lockout | e2e |
| 7 | **Sensitive data exposure** | C3 column encryption, masking, signed-URL files, TLS, no public buckets | Code review |
| 8 | **File-upload abuse** | MIME + magic-byte validation, size cap, sanitised keys, private storage | Unit + manual |
| 9 | **Insecure direct object refs to files** | No public URLs; short-TTL signed URLs scoped to principal | Manual |
| 10 | **Rate-limit / brute force** | Per-IP + per-account limits on auth and bulk endpoints | e2e |
| 11 | **Security misconfiguration** | HSTS, secure headers, least-privilege creds, env-separated secrets | Release checklist |
| 12 | **Insufficient logging** | Comprehensive immutable `audit_log`; error tracking | Code review |
| 13 | **Financial tampering / auto-money-movement** | No auto transfers; manual Paid marking; locked paid rows; override audit | RBAC §6 + integrity tests |

---

## 13. Incident response (note)

A lightweight IR procedure for v1:
1. **Detect & triage** — error tracking / anomalous `audit_log` access flags an incident; classify severity (PII breach vs availability).
2. **Contain** — revoke compromised credentials/keys (rotate `ENCRYPTION_KEY`/`NEXTAUTH_SECRET`/storage keys), disable affected accounts, take the app to maintenance if needed.
3. **Assess** — use `audit_log` + backups to scope what data was accessed/changed.
4. **Notify (PDPA breach notification):** if a notifiable data breach occurs (significant harm or scale threshold), notify the **PDPC and affected individuals** within the statutory timeframe. The DPO owns this.
5. **Recover** — restore from Singapore-region backups (`10_Deployment_Runbook.md` §4), verify integrity, reconcile financial ledger.
6. **Post-incident review** — root cause, remediation, update this checklist.

---

*References: `Enshrine_Portal_PRD.md` (master), `05_RBAC.md` (roles/scoping canonical), `02_Database_Diagram.md` (entities/encrypted columns).*
