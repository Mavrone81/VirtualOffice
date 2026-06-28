# Coding Standards & Conventions — Enshrine Associate Management Portal

**Version:** 1.0 · **Source of truth:** `Enshrine_Portal_PRD.md` v1.2 (§4 stack, §9 rules) · **References:** `02_Database_Diagram.md` (naming/enums), `05_RBAC.md` (authorization), `08_Security_and_PDPA.md` (PII/secrets)
**Stack:** Next.js (App Router, TypeScript) + PostgreSQL + Prisma + NextAuth/Auth.js + Tailwind + shadcn/ui.

These conventions are written so Codex and any engineer produce consistent, auditable, money-safe code.

---

## 1. TypeScript strictness

- `tsconfig.json` runs in **`strict: true`** with additionally: `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`.
- **No `any`** — use `unknown` + narrowing, or a proper type. ESLint forbids implicit/explicit `any` in app code.
- **No non-null `!`** to silence the compiler — narrow or guard instead.
- Prefer `type`/`interface` from a single domain types module; derive DB types from the Prisma client, never hand-duplicate them.
- All exported functions have explicit return types.

---

## 2. Project structure (reference)

Conventional Next.js App Router layout (see `07_Architecture.md` for the authoritative diagram):

```
src/
  app/                 # routes, layouts, server actions (App Router)
    (auth)/ admin/ accounts/ sales/ team/ ...
  components/          # shadcn/ui-based + composed components
  server/
    auth/              # NextAuth/Auth.js config, session → principal
    rbac/              # can(principal, action, resource); downline scoping
    services/          # business logic: commission engine, payouts, invoicing
    repositories/      # Prisma access — principal-required, scope-injecting
  lib/                 # money, dates, zod schemas, formatting, encryption
  emails/              # transactional templates
prisma/
  schema.prisma  migrations/  seed.ts
```

- Business logic lives in `server/services` (pure where possible — the commission engine is a pure function of its inputs, PRD §8.1, for testability).
- Data access only through `server/repositories` — never call Prisma from a component or route handler directly.

---

## 3. Naming conventions

| Layer | Convention | Example |
|---|---|---|
| **Database** (tables, columns) | `snake_case` | `sales_transactions`, `closing_associate_id`, `company_cut_pct` |
| **Postgres enums** | values exactly as in `02_Database_Diagram.md` §3 | `approval_status`, values `Pending`/`Approved`/... |
| **Prisma models** | `PascalCase` model `@@map`'d to snake_case table; fields `camelCase` `@map`'d to snake_case columns | `model SalesTransaction { closingAssociateId String @map("closing_associate_id") @@map("sales_transactions") }` |
| **TypeScript** vars/functions | `camelCase` | `computeCommission`, `downlineClosure` |
| **Types/classes/components** | `PascalCase` | `CommissionLedgerLine`, `PayoutTable` |
| **Constants** | `UPPER_SNAKE_CASE` | `COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD` |
| **Files** | components `PascalCase.tsx`; others `kebab-case.ts` | `SubmitSaleForm.tsx`, `commission-engine.ts` |
| **Routes** | `kebab-case` | `/sales/submit`, `/bank-file` |

Enum string values used in code/UI must match the DB enum values **verbatim** (e.g. `"Company Retained"`, `"Computer-Generated"`, `"Pending Collection"`) — they are the canonical contract.

---

## 4. Money handling

- Money is **`NUMERIC(14,2)` in Postgres**, **never float** (PRD §4, §9.11). Currency is **SGD** throughout.
- In TypeScript, represent money with **Prisma `Decimal`** (decimal.js) or **integer cents** — never JavaScript `number` for arithmetic. All commission math uses decimal arithmetic.
- Round each money value to **2 dp**; per the engine (§8.1), push the residual into **Company Retained** so the core split reconciles exactly (`net_to_closer + total_override + company_retained == closing_commission`) — **zero rounding leakage**.
- A single `lib/money.ts` provides `round2`, add/subtract/multiply, and formatting (`$1,000.00`). No ad-hoc `toFixed` arithmetic.
- **GST-ready, default off:** all invoice/commission math supports a GST toggle + rate but does not apply it until enabled (PRD §6.5).

---

## 5. Dates & timezone

- **Store UTC** (`timestamptz`), **render Asia/Singapore** (PRD/DB convention).
- Date-only fields (`sales_date`, `due_date`, `effective_date`, `paid_date`) use `date`.
- `payout_month` is a `YYYY-MM` string keyed to when commission became eligible (PRD §8.3).
- All timezone conversion at the render boundary via a single `lib/date.ts`; never construct local dates ad hoc. Structure-version resolution by `sales_date` must be timezone-stable.

---

## 6. Error handling & validation

- **zod** validates every external input at the server-action / route-handler boundary before any logic runs (`08_Security_and_PDPA.md` §4.3). Define schemas in `lib/schemas/`; infer TS types from them (single source).
- Validate domain rules server-side too: `amount_collected <= sale_amount`, acyclic upline, override pool sums to 100% (PRD §6.5, §9).
- Use typed result/error objects or thrown domain errors mapped to HTTP/action responses; **never leak stack traces or PII** in error messages (log full detail to the error tracker only).
- Authorization failures return **403** (RBAC §6) — never an empty 200 that leaks existence.

---

## 7. API / server-action patterns

- Mutations are **server actions** (or POST route handlers); all are **origin/CSRF-protected** and re-check `can(principal, action, resource)` (RBAC §4) — client role claims are never trusted.
- Every request resolves a **principal** `{ userId, role, associateId }` from the session before any data access.
- **Scoped reads** go through repository methods that **require a principal** and inject the downline-closure (or self) predicate — it must be impossible to construct an unscoped query (RBAC §3).
- Multi-row money writes (commission run, payout, installment recompute) are wrapped in a **DB transaction**; the commission engine is **idempotent** (delete+reinsert ledger lines per transaction).
- Privileged/financial actions write to `audit_log` with actor + before/after (`08_Security_and_PDPA.md` §10).
- Endpoint ↔ role/scope mappings live in `04_API_Documentation.md`.

---

## 8. Component conventions (shadcn / Tailwind)

- UI built on **shadcn/ui** primitives + **Tailwind**; avoid bespoke CSS files. Use the design tokens / theme, not hard-coded colors.
- **Server Components by default**; add `"use client"` only when interactivity requires it. Data fetching happens server-side through services/repositories.
- Components are presentational; no business logic or direct Prisma calls in components.
- Sensitive fields are **masked at the serializer**, not in the component (`08_Security_and_PDPA.md` §3) — components never receive unmasked NRIC/bank for non-Admin/Accounts roles.
- Reusable, accessible form components; consistent loading/empty/error states (PRD §10 usability).

---

## 9. Commit & PR conventions

- **Conventional Commits:** `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:` — e.g. `feat(commission): installment 3rd-payment eligibility trigger`.
- Small, focused PRs; description references the PRD section / doc it implements and the acceptance criteria it satisfies.
- PR requires: green CI (lint, typecheck, test, build — `10_Deployment_Runbook.md` §2), at least one review, and migration review if schema changed.
- Branches: `feature/*`, `fix/*` → `develop`; `develop` → `main` for release.

---

## 10. Linting & formatting

- **ESLint** (Next.js + TypeScript config; `no-explicit-any`, import order, no floating promises) and **Prettier** (formatting) are authoritative; `prettier --check` and `eslint` run in CI.
- Format on save / pre-commit hook; do not hand-format. No committed lint or type errors.

---

## 11. Accessibility & i18n

- **Accessibility:** semantic HTML, labelled form controls, keyboard navigation, sufficient contrast, ARIA where shadcn primitives need it. Target WCAG AA for core flows (login, submit sale, dashboards, payouts).
- **i18n:** primary language **English**; users are **bilingual (English + Chinese)** — keep all user-facing strings in a centralized resource (no hard-coded copy in components) so a Chinese locale can be added without code changes. Enum/domain values stay canonical (English) in the DB; localize only the **display label**, not the stored value.

---

## 12. Definition of Done

A unit of work is done when:
- [ ] Implements the relevant PRD section; matches `02_Database_Diagram.md` (schema/enums) and `05_RBAC.md` (authorization/scoping).
- [ ] TypeScript strict-clean; ESLint + Prettier pass; no `any`.
- [ ] Inputs validated with zod; authorization re-checked server-side; scoped reads principal-bound.
- [ ] Money uses Decimal/cents, reconciles to the cent; dates stored UTC / rendered SGT.
- [ ] Privileged/financial actions audit-logged; no PII in logs/errors.
- [ ] Unit + integration tests added/updated and green; relevant `09_Test_Plan.md` cases covered (commission cases reconcile; RBAC 403s pass).
- [ ] User-facing strings externalized; core flow accessible.
- [ ] PR follows commit/PR conventions; CI green; migration reviewed if schema changed.

---

*References: `Enshrine_Portal_PRD.md` (master), `02_Database_Diagram.md` (naming/enums), `05_RBAC.md` (authorization), `08_Security_and_PDPA.md` (PII/secrets).*
