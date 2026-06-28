# Role-Based Access Control (RBAC) — Enshrine Associate Management Portal

**Version:** 1.0 · **Source:** PRD v1.2 §2, §5 · **Anchors:** `02_Database_Diagram.md` (users, associates)

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

---

## 3. Permission matrix

Legend: ✅ full · 🔵 scoped (downline/own) · 🟡 self only · ❌ none

| Capability | Admin | Accounts | SD | SM | Consultant |
|---|---|---|---|---|---|
| Manage users & roles | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage companies / invoice entities | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage products, com codes, rates/versions | ✅ | ❌ | ❌ | ❌ | ❌ |
| Review/approve recruitment | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit Associate Master | ✅ | ✅ | ❌ | ❌ | ❌ |
| View Associate Master | ✅ | ✅ | 🔵 | 🔵 | 🟡 |
| Submit a sale | ✅ | ✅ | ✅ | ✅ | ✅ |
| Verify/approve a submitted sale | ✅ | ✅ | ❌ | ❌ | ❌ |
| Generate / manage invoices | ✅ | ✅ | 🔵 own | 🔵 own | 🟡 own |
| Mark invoice / installment paid | ✅ | ✅ | ❌ | ❌ | ❌ |
| Run commission engine | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manual commission override | ✅ | ❌ | ❌ | ❌ | ❌ |
| View commission ledger | ✅ | ✅ | 🔵 | 🔵 | 🟡 |
| Manage payouts (approve/mark paid) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Generate bank GIRO file | ✅ | ✅ | ❌ | ❌ | ❌ |
| View payout status | ✅ | ✅ | 🔵+self | 🔵+self | 🟡 |
| Post notices | ✅ | ✅ | ❌ | ❌ | ❌ |
| View notices / documents | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage vendor referral registry | ✅ | ✅ | view | view | view |
| Submit vendor referral | ✅ | ✅ | ✅ | ✅ | ✅ |
| View dashboards | ✅ global | ✅ global | 🔵 team | 🔵 team | 🟡 personal |
| Contacts export | ✅ | ✅ | ❌ | ❌ | ❌ |

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
| `/accounts/**` (verification, invoices, payouts) | Accounts+ | global |
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
