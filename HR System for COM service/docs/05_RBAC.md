# Role-Based Access Control (RBAC) — Enshrine Associate Management Portal

**Version:** 1.1 · **Source:** PRD v1.5 §2, §5 · **Anchors:** `02_Database_Diagram.md` (users, associates, candidates, p_files)

This document is the canonical authority for roles, permissions, and data scoping. All other docs (API, URD, Workflow) reference the role names and the scoping rules defined here.

---

## 1. Roles
| Role (enum `app_role`) | Who | Summary |
|---|---|---|
| **Admin** | Samuel / Enshrine ops ("Product Owner") | Full access; manages companies, products, com codes, commission rates, users; runs engine; manages payouts/bank file. |
| **Accounts** | Finance/HR staff | Verifies sales, manages invoices/payments, manages payouts; keys HR detail; posts notices. (May be merged with Admin in early v1.) |
| **SalesDirector** | SD associates | Self-service virtual office; scope = full downline; submit sales; generate own invoices; view downline commissions/payouts. |
| **SalesManager** | SM associates | As SD, scope = own (smaller) downline. |
| **Consultant** | Sales Consultant associates | Submit own sales; generate own invoices; view own commissions/payouts; personal dashboard only. |

`designation` (org rank) is distinct from `role` (app permission). A user's role is derived from their linked associate's designation at provisioning, but can be overridden (e.g. an SD who is also an Admin).

> **Candidate (pre-login, no role):** a `candidates` record is **not** a logged-in principal and has **no `app_role`**. A candidate acts only through a **secure tokenised onboarding link** (see §2.1) to complete the Onboarding Form and e-sign — they cannot log in to the virtual office until Admin/Accounts approval converts them into an `associate` with a provisioned `users` login.

---

## 2. Data-scoping model

Scope is enforced **server-side on every query**, never by hiding UI alone.

- **Admin / Accounts** → global (all rows).
- **SalesDirector / SalesManager** → **downline closure**: themselves + every associate recursively below them via `direct_upline_id`.
- **Consultant** → self only.

**Downline closure (Postgres recursive CTE):**
```sql
WITH RECURSIVE downline AS (
  SELECT id FROM associates WHERE id = :current_associate_id
  UNION ALL
  SELECT a.id FROM associates a
  JOIN downline d ON a.direct_upline_id = d.id
  WHERE a.archived_at IS NULL
)
SELECT id FROM downline;
```
Every scoped resource (associates, sales, ledger, payouts, dashboards) filters its `associate_id`/`closing_associate_id` to this set (plus self). Out-of-scope access returns **403**, never an empty 200 that could leak existence.

**Gating overlay:** regardless of scope, only associates with `approval_status = Approved` AND `associate_status = Active` may be a closer, receive payouts, appear in Contacts export, or in manager dashboards.

### 2.1 Pre-login tokenised onboarding access (candidates)

A candidate has **no session and no role**, so the standard principal/scope model does not apply to them. Onboarding is reached through a **single-purpose, signed `onboarding_token`** emailed to the candidate (PRD §6.1):

- The token authorises **only** the Onboarding Form for **its own `candidates` row** — reading that candidate's draft and writing the submission/signature. It grants **no** access to any other candidate, associate, or virtual-office route.
- Tokens are **single-candidate, scoped, and expiring**; an expired/invalid/used-up token returns **403/410** with no associate or candidate data exposed.
- No `app_role` can be assumed from a token; a logged-in principal is created **only** at approval, when the candidate is converted to an `associate` + `users` login.
- Token issuance, the form submission, the e-sign, and the approve/reject decision are all `audit_log`ged (`invited_by`, `reviewed_by`).

---

## 3. Permission matrix

Legend: ✅ full · 🔵 scoped (downline/own) · 🟡 self only · ❌ none. The **Candidate** column refers to a pre-login candidate acting via a tokenised onboarding link (§2.1), not an `app_role`.

| Capability | Admin | Accounts | SD | SM | Consultant | Candidate (token) |
|---|---|---|---|---|---|---|
| Manage users & roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage companies / invoice entities | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage products, com codes, rates/versions | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage candidates / send onboarding invite | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Complete onboarding form (form + e-sign) | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 own token |
| Approve / reject candidate | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit Associate Master | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View Associate Master | ✅ | ✅ | 🔵 | 🔵 | 🟡 | ❌ |
| View own P-file (signed agreement / HR docs) | ✅ | ✅ | 🟡 own | 🟡 own | 🟡 own | ❌ |
| Manage all P-files (file/remove docs) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View downline P-files | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Upload/assign documents (Vendor MOU / Sales Agreement) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Download assigned sales agreements | ✅ | ✅ | 🔵 assigned | 🔵 assigned | 🔵 assigned | ❌ |
| View/download own name card / VCF | ✅ | ✅ | 🟡 own | 🟡 own | 🟡 own | ❌ |
| View others' name card / VCF | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Submit a sale | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Verify/approve a submitted sale | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Generate / manage invoices | ✅ | ✅ | 🔵 own | 🔵 own | 🟡 own | ❌ |
| Mark invoice / installment paid | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Run commission engine | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manual commission override | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View commission ledger | ✅ | ✅ | 🔵 | 🔵 | 🟡 | ❌ |
| Manage payouts (approve/mark paid) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Generate bank GIRO file | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View payout status | ✅ | ✅ | 🔵+self | 🔵+self | 🟡 | ❌ |
| Post notices | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View notices / documents | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manage vendor referral registry | ✅ | ✅ | view | view | view | ❌ |
| Submit vendor referral | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| View dashboards | ✅ global | ✅ global | 🔵 team | 🔵 team | 🟡 personal | ❌ |
| Contacts export | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

**Notes on the v1.3 rows:**
- **Candidate management / onboarding invite** and **approve/reject candidate** are Admin/Accounts only; the candidate themselves acts only via the tokenised onboarding link (§2.1) — they have no `app_role`.
- **P-files are HR-sensitive.** Owners (any role) may view/download **their own** P-file; Admin/Accounts manage **all** P-files. **Managers (SD/SM) do NOT see downline P-files by default** — viewing a downline associate's P-file returns **403**, even though the manager can otherwise scope to that associate.
- **Sales agreements:** Admin/Accounts upload, assign (`All`/`Team`/`Associate`), replace and revoke `Vendor MOU` / `Sales Agreement` documents; associates have **download-only**, **scoped to their assignment** (by All / their Team / themselves) under the Sales Agreements tab.
- **Name card / VCF:** every user may view/download **their own** card and `.vcf`; only **Admin** may view others'.

---

## 4. Enforcement patterns (implementation guidance)

1. **Session → principal:** auth middleware resolves `{ userId, role, associateId }` from the session cookie on every request.
2. **Policy layer:** a central `can(principal, action, resource)` (e.g. CASL/Oso or hand-rolled) checks the matrix above. Controllers call it before any data access.
3. **Scope filter:** scoped reads always inject the downline-closure (or self) predicate at the query layer — make it impossible to query unscoped by constructing repository methods that *require* a principal.
4. **Write authorization:** mutations re-check `can(...)` server-side; never trust client role claims.
5. **Field-level masking:** `nric` and `bank_account_number` are decrypted/served only to Admin/Accounts; masked (`S****892A`) for everyone else, including the owning associate by default.
6. **Audit:** every privileged action (approve, verify, run engine, manual override, mark paid, rate change, payout status change) writes to `audit_log` with actor, before/after.
7. **Default deny:** any action not explicitly granted is denied.

---

## 5. Route protection map (summary)
| Route group | Min role | Scope |
|---|---|---|
| `/admin/**` | Admin | global |
| `/admin/candidates/**`, candidate invite/approve/reject | Accounts+ | global |
| `/onboard/[token]` (form + e-sign) | none (tokenised, §2.1) | single candidate by token |
| `/accounts/**` (verification, invoices, payouts) | Accounts+ | global |
| `/me/p-file`, `/me/name-card`, `/me/sales-agreements` | Consultant+ | own |
| `/admin/p-files/**`, `/admin/documents/**` (upload/assign) | Accounts+ | global |
| `/sales/submit`, `/sales/my/**` | Consultant+ | own |
| `/team/**` (dashboards, downline) | SalesManager+ | downline |
| `/commission/run`, `/payouts/run`, `/bank-file` | Accounts+ | global |
| `/notices` (read), `/documents` (read), `/vendors` (read) | Consultant+ | all/own |
| `/notices` (post), `/vendors` (edit) | Accounts+ | global |

See `04_API_Documentation.md` for endpoint-level mappings.

---

## 6. Test cases (must pass)
- A Consultant requesting another associate's ledger → **403**.
- An SM querying an associate outside their downline → **403** (not empty list).
- A Pending/Inactive associate never appears as a selectable closer or in any payout/dashboard.
- Only Admin can submit a manual commission override; attempt by Accounts → 403.
- `nric`/`bank_account_number` returned masked to SD/SM/Consultant.
- Role escalation via tampered client payload is rejected (server re-checks).
- A candidate's `onboarding_token` accesses only its own onboarding form; reuse for another candidate or any virtual-office route → **403/410**; an expired/used token → **403/410** with no data leak.
- Only Admin/Accounts can create/invite or approve/reject a candidate; attempt by SD/SM/Consultant → **403**.
- An SD/SM requesting a downline associate's P-file → **403** (P-files are HR-sensitive; managers do not see downline P-files).
- An associate can download a sales agreement only if it is assigned to them (All / their Team / themselves); a non-targeted associate → **403**.
- A non-owner (non-Admin) requesting another user's name card / VCF → **403**.
