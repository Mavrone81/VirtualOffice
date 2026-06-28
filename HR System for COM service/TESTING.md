# TESTING.md — Enshrine Associate Management Portal (VirtualOffice)

**Version:** 1.0 · **Source of truth:** `Enshrine_Portal_PRD.md` v1.2 · **References:** `docs/04_API_Documentation.md` (endpoints), `docs/05_RBAC.md` (roles/scoping), `docs/02_Database_Diagram.md` (entities), `docs/03_Workflow_Diagrams.md` (workflows), `docs/09_Test_Plan.md` (QA strategy).
**Stack under test:** Next.js (App Router, TypeScript) + PostgreSQL + Prisma + NextAuth/Auth.js + S3-compatible storage + SMTP email.

> **Status:** the application is specified but **not yet built**. This document is the executable test plan the implementation must satisfy — every function, endpoint, and workflow below maps to a documented requirement. As Codex builds each module, the corresponding tests are written and turned green. Items marked _(deferred)_ correspond to PRD Won't-have-v1 features (payment gateway, AI festive generator, full vendor LMS).

---

## 1. Test strategy & tooling

| Layer | Scope | Tooling | Runs against |
|---|---|---|---|
| **Unit** | Pure functions, domain logic, validators, helpers | **Vitest** + ts | Mocked deps (no DB/network) |
| **Integration** | API routes / server actions, DB, storage, email | **Vitest** + **Supertest**-style route calls + **Prisma test DB** | Ephemeral Postgres (Docker/Testcontainers); S3 → MinIO; SMTP → Mailpit/MailHog |
| **E2E** | Full user journeys through the UI | **Playwright** | Seeded app on disposable env |
| **Static** | Types, lint, format | `tsc --noEmit`, ESLint, Prettier | n/a |

**Principles**
- Money assertions use exact `Decimal`/`NUMERIC(14,2)` equality — no float tolerance; every commission test asserts **reconciliation to zero residual**.
- External dependencies (S3, SMTP, future payment gateway) are **mocked in unit**, **faked with real local services in integration** (MinIO, Mailpit), and **stubbed/sandboxed in E2E**.
- Permission tests assert **403 (not empty 200)** for out-of-scope access (`05_RBAC.md` §6).
- Each test is deterministic: fixed clock (`vi.setSystemTime`), seeded RNG, isolated DB per worker (transaction rollback or schema-per-worker).
- Coverage target: **≥ 90% lines / ≥ 85% branches** on `lib/`/`server/` domain code; engine + RBAC + invoicing are **100% branch**.

---

## 2. Layer 1 — Unit tests (function → cases)

Organised by domain module (suggested `lib/` / `server/domain/`).

### 2.1 Commission engine — `computeCommission(tx, structure, comCodes, uplineChain)`
| Case | Expectation |
|---|---|
| Worked example: sale 10,000, closing 10%, cut 40%, SM 20%, SD 10% | closing **1,000**, pool **400**, net-to-closer **600**, SM override **80**, SD override **40**, retained **280**; sum = 1,000 ✓ |
| Reconciliation | personal + overrides + retained == closing_commission (zero residual after rounding) |
| Consultant upline (rank 0%) | upline override = 0; retained absorbs it |
| Only direct upline present (no 2nd) | single override; retained = pool − override |
| No eligible upline (both Inactive) | overrides = 0; retained = full pool |
| Override rate by rank | ASM→asm%, SM→sm%, SD→sd% resolved correctly |
| Add-on com code — Percentage | adds `sale_amount × value%` as Add-on line |
| Add-on com code — Absolute | adds fixed `value` as Add-on line |
| Multiple add-ons ticked | each produces a discrete Add-on ledger line |
| Rounding edge (e.g. 33.335) | round-half rule applied; residual pushed to Company Retained |
| External product branch | `External Payable` line to provider + small `external_company_retained` for Enshrine; associate override small/zero per config |
| Manual override line | supplied amount supersedes computed; flagged `is_manual_override`, reason recorded; reconciliation relaxed but total recorded |
| Idempotency | running twice for same tx yields identical ledger (delete+reinsert, no duplicates) |
| Zero/negative sale guard | rejects/raises on sale_amount ≤ 0 |

### 2.2 Eligibility — `computeEligibility(tx, installments)`
| Case | Expectation |
|---|---|
| Closer not Approved+Active | `Ineligible` |
| Full Payment, fully collected, verified | `Eligible` |
| Installment, 0 paid | `Pending Collection` |
| Installment, < threshold paid (default 3rd) | `Pending Collection` / `Partially Eligible` per config |
| Installment, threshold reached (3rd paid) | `Eligible`; payout_month = month threshold met |
| Recompute after marking an installment paid | transitions correctly and triggers engine re-run |

### 2.3 Installment calculator — `buildInstallmentSchedule(total, deposit, count)`
| Case | Expectation |
|---|---|
| 3,800 total, deposit 800, 12 months | 12 rows summing to 3,000; final row absorbs rounding residual |
| total == deposit | empty/zero schedule |
| count = 1 | single installment = balance |
| GST flag off (default) | no tax added |
| GST flag on (>S$1M) _(future)_ | tax applied per rate; totals reconcile |
| Adjustment (renegotiation) | preserves paid rows; recomputes only remaining; new schedule reconciles to outstanding balance |
| Invalid (deposit > total, count ≤ 0) | validation error |

### 2.4 Invoice numbering — `allocateInvoiceNumber(companyId)`
| Case | Expectation |
|---|---|
| Sequential per company | `INV-<PREFIX>-YYYY-#####` increments atomically |
| Concurrency (parallel calls) | no duplicates (atomic `invoice_next_seq`) |
| Multiple companies | independent sequences (Enshrine vs Trust Pets) |

### 2.5 Hierarchy — `assertNoCycle(associate, newUplineId)` / `getDownlineClosure(id)`
| Case | Expectation |
|---|---|
| Self as own upline | rejected |
| Indirect cycle (A→B→A) | rejected |
| Valid chain | accepted |
| Downline closure | returns self + all recursive descendants; excludes archived |

### 2.6 Associate ID — `nextAssociateCode()`
| Case | Expectation |
|---|---|
| First | `EN0001` |
| After EN0007 | `EN0008` (zero-padded, monotonic) |
| Immutable | existing codes never reassigned |

### 2.7 Validators (zod) — recruitment / sale / product
| Case | Expectation |
|---|---|
| NRIC format (SG) | valid passes, malformed rejected |
| Mobile (8-digit SG) | enforced |
| Email format | enforced |
| `amount_collected ≤ sale_amount` | enforced |
| Override %ages sum ≤ 100% of pool | rejected if exceeded |
| DOB in past, join_date present | enforced |

### 2.8 PII crypto + masking — `encryptField` / `maskNric` / `maskBankAccount`
| Case | Expectation |
|---|---|
| Encrypt→decrypt round-trip | original recovered |
| Mask NRIC | `S****892A` style; only Admin/Accounts see full |
| Mask bank account | masked for SD/SM/Consultant |

### 2.9 Money helpers — `round2`, `toCents`, `sumLedger`
| Case | Expectation |
|---|---|
| No float drift | Decimal arithmetic exact |
| Round-half rule | consistent across engine |

### 2.10 Bank GIRO file — `buildGiroFile(payouts)`
| Case | Expectation |
|---|---|
| Format matches bank spec | header/detail/trailer correct (spec TBC, PRD §16) |
| Totals line | equals sum of payout rows |
| Only selected payouts | excludes Pending/Cancelled |

---

## 3. Layer 2 — Integration tests (endpoint / connection → cases)

Run against an ephemeral Postgres + MinIO + Mailpit. Each endpoint tested for **happy path, validation error, authn (401), authz/scope (403)**. Endpoints per `docs/04_API_Documentation.md`.

### 3.1 Auth
| Endpoint | Cases |
|---|---|
| `POST /auth/login` | valid → session cookie; bad creds → 401; locked account → 403 |
| `POST /auth/logout` | clears session |
| `GET /auth/me` | returns principal; unauthenticated → 401 |
| `POST /auth/reset` | issues reset; unknown email → generic 200 (no enumeration) |

### 3.2 Recruitment & associates
| Endpoint | Cases |
|---|---|
| `POST /associates/recruit` | creates Pending/Inactive + `EN####` + agreement; invalid NRIC → 422 |
| `POST /associates/{id}/sign` | stores signed PDF; non-applicant → 403 |
| `POST /associates/{id}/approve` | Admin/Accounts only; sets Approved+Active, opens login; SD attempt → 403 |
| `GET /associates` | Admin all; SM downline only; Consultant self; out-of-scope id → 403 |
| `PATCH /associates/{id}` | status change side-effects (Terminated stops future eligibility, keeps history) |
| `GET /associates/contacts.csv` | Approved + (Active|Terminated) only; non-admin → 403 |

### 3.3 Companies / products / com codes
| Endpoint | Cases |
|---|---|
| `POST /companies` | Admin only; invoice prefix unique |
| `POST /products` | Admin; override sum ≤ 100% enforced; external flag stored |
| `POST /products/{code}/rate-change` | new effective-dated version; historical tx unaffected |
| `POST /products/{id}/com-codes` | percentage/absolute add-on created |
| `GET /products` | active-only selectable at submission |

### 3.4 Sales submission → verification → transaction
| Endpoint | Cases |
|---|---|
| `POST /sales/submissions` | any associate; ineligible closer → 422; inactive product → 422; add-ons captured |
| `GET /sales/submissions` | scoped (downline/self) |
| `POST /sales/submissions/{id}/verify` | Accounts/Admin only; creates transaction + upline snapshot + resolves structure version; SD → 403 |
| `GET /sales/transactions` | scoped; eligibility field correct |

### 3.5 Invoicing & installments
| Endpoint | Cases |
|---|---|
| `POST /invoices` | generates per-company number + PDF; computer-generated type carries no-signature footer |
| `GET /invoices?status=Outstanding` | lists outstanding, scoped |
| `POST /invoices/{id}/mark-paid` | Accounts/Admin; flips Paid + paid_date; updates eligibility; SD → 403 |
| `POST /installments` | auto-calc schedule; sums to total |
| `PATCH /installments/{planId}` | adjustment preserves paid rows |
| `GET /invoices/{id}/pdf` | returns signed URL; scope enforced |

### 3.6 Commission engine, ledger, payouts, bank file
| Endpoint | Cases |
|---|---|
| `POST /commission/run` | Accounts/Admin; idempotent (re-run no duplicates); worked example reconciles |
| `POST /commission/ledger/{id}/manual-override` | Admin only; Accounts → 403; audit-logged |
| `GET /commission/ledger` | scoped (downline/self) |
| `POST /payouts/run` | aggregates eligible ledger → payout rows; only `Eligible` lines |
| `POST /payouts/{id}/approve` / `mark-paid` | status workflow; Paid locks row + paid_date |
| `GET /payouts` | scoped; total = personal+override+add-on |
| `POST /bank-file` | generates GIRO file matching selected payouts; non-admin → 403 |

### 3.7 Dashboards, notices, documents, vendor referrals, audit
| Endpoint | Cases |
|---|---|
| `GET /dashboard/personal|team|director|admin` | tiles reconcile with ledger; scope enforced (SM sees only downline) |
| `POST /notices` | Accounts/Admin; broadcasts in-app + email (Mailpit asserts send) |
| `GET /notices` / `POST /notices/{id}/read` | feed visible to all; read tracked |
| `GET/POST /documents` | templates visible to all; "My Agreement" owner-scoped |
| `POST /vendors` | timestamped first-claim; `GET /vendors` view-only to associates; edit non-admin → 403 |
| `GET /audit-log` | Admin only |

### 3.8 External connections
| Connection | Cases |
|---|---|
| **Database (Postgres/Prisma)** | migrations apply; CRUD; unique constraints (invoice no., payout month); transaction rollback on error |
| **Object storage (S3/MinIO)** | upload agreement/invoice/photo; signed-URL read; access denied without scope |
| **Email (SMTP/Mailpit)** | notice + approval + payout-paid emails enqueued & sent; no PII in body beyond necessary |
| **Payment gateway** _(deferred)_ | placeholder test asserts feature flag OFF returns "not enabled" |

---

## 4. Layer 3 — E2E tests (workflow → steps)

Playwright, seeded app (7 associates, ≥1 company, products incl. external). Workflows per `docs/03_Workflow_Diagrams.md` / URD epics.

| # | Workflow | Steps / assertions |
|---|---|---|
| E1 | **Recruitment → virtual office** | Submit recruitment form → auto-generated agreement → e-sign (and PDF-download fallback) → Admin approves+activates → first login forces photo → dashboard loads |
| E2 | **Sales submission → verification → transaction** | Consultant submits sale with add-on com codes → Accounts verifies → transaction created with upline snapshot + eligibility |
| E3 | **Full-payment invoice + commission** | Generate computer-generated invoice → mark paid → run engine → ledger shows 600/80/40/280 → appears on payout |
| E4 | **Installment journey** | Create installment plan (auto-schedule) → mark installments paid → commission becomes payable on 3rd → payout reflects it |
| E5 | **Installment renegotiation** | Adjust plan mid-way → paid rows preserved → remaining reschedule reconciles |
| E6 | **Monthly payout + bank file** | Run payout → approve → generate GIRO file → mark paid (row locks) → statement PDF downloads |
| E7 | **Manager dashboard scoping** | SM logs in → sees only downline; attempts to open out-of-scope associate → blocked (403/redirect) |
| E8 | **External product sale** | Sell columbarium (external) → ledger shows External Payable + small Enshrine cut |
| E9 | **Notice broadcast** | Admin posts notice → associate sees it on home feed + email; mark read |
| E10 | **Documents / My Agreement** | Associate downloads company template + own signed agreement |
| E11 | **Vendor referral first-claim** | Two associates submit same vendor → earliest timestamp wins; registry view-only |
| E12 | **Manual override (Admin)** | Admin sets manual commission on a complex/external tx → reflected in ledger + audit log |
| E13 | **Failure/recovery** | Verify with ineligible closer blocked; double mark-paid idempotent; expired session → re-auth |

---

## 5. How to run

**Local**
```bash
pnpm install
pnpm test:unit            # vitest run (unit)
pnpm test:int             # vitest run integration (spins up test DB / MinIO / Mailpit)
pnpm test:e2e             # playwright test (against seeded local app)
pnpm test                 # all layers
pnpm coverage             # vitest --coverage
pnpm typecheck && pnpm lint
```

**Disposable services for integration (example `docker-compose.test.yml`)**: Postgres, MinIO, Mailpit — torn down after the run (Testcontainers preferred so each run is isolated).

**In CI** (per `docs/10_Deployment_Runbook.md` §2): lint → typecheck → **unit + integration (ephemeral DB)** → build → deploy (staging) → **Playwright e2e on staging** (or nightly). A failing layer blocks the pipeline.

---

## 6. Coverage summary & gaps

| Area | Target | Notes |
|---|---|---|
| Commission engine, eligibility, invoicing, RBAC scoping | **100% branch** | financial + security critical |
| Domain `lib/`/`server/` | ≥ 90% line / ≥ 85% branch | |
| API routes | every endpoint × {happy, validation, 401, 403} | |
| UI components | smoke + key interactions | exhaustive component tests not required |

**Known gaps / deferred (with reason)**
- **Payment gateway** — Won't-have-v1; only a feature-flag-off test exists until Stripe/HitPay is adopted (PRD §1.3).
- **AI festive/DM generator** — deferred; static-template path tested only.
- **Full vendor/logistics LMS** — separate future product; only the view-only referral registry is in scope here.
- **Bank GIRO file format** — exact spec pending (PRD §16); format tests are stubbed against an assumed layout and must be re-pinned once the bank spec is provided.
- **GST math** — flag off until >S$1M revenue; GST cases written but skipped (`it.skip`) until enabled.

---

## 7. Traceability (acceptance → tests)

| PRD §14 acceptance criterion | Test(s) |
|---|---|
| §8.2 example → 600/80/40/280, reconciles | 2.1, E3 |
| Add-on com codes compute & attribute | 2.1, 3.3, E2 |
| Pending/Inactive/unverified never a closer/payout/dashboard | 2.2, 3.2, 3.4, E2, E7 |
| Installment commission only at threshold | 2.2, 2.3, E4 |
| Per-company unique invoice numbers + no-signature footer | 2.4, 3.5, E3 |
| Rate change never alters historical payouts | 3.3 |
| Engine idempotent | 2.1, 3.6 |
| Bank file matches selected payouts | 2.10, 3.6, E6 |
| Managers/consultants strictly scoped (403) | 2.5, 3.2, 3.6, E7 |
| Money reconciles, zero leakage | 2.1, 2.9 |

---

*References: `Enshrine_Portal_PRD.md` (master), `docs/04_API_Documentation.md`, `docs/05_RBAC.md`, `docs/03_Workflow_Diagrams.md`, `docs/09_Test_Plan.md` (strategy), `docs/10_Deployment_Runbook.md` (CI).*
