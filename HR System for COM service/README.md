# Enshrine Associate Management Portal

> **Status: spec/PRD stage — to be built by Codex.** This repository currently holds the product spec and design documents (PRD + `docs/`). The application has not been implemented yet; the sections below describe the intended build so Codex can generate it.

A single-tenant **CRM + HRMS "virtual office"** for a Singapore funeral-services and pet-aftercare business (public site: enshrinepets.com.sg). Commission-based **associates** sell packages across product lines — Cremation, Religious Rites, Columbarium (niche), Sea Scattering, funeral services/packages, pet aftercare, niche/memorial, and temple/festive events — and the portal runs their full lifecycle and earnings end-to-end, online, with no need to visit a physical office. Invoices are issued under **multiple brands/entities** (e.g. Enshrine, Trust Pets).

---

## Purpose

Replace fragile spreadsheet formulas and painful one-by-one bank transfers with an auditable, automated commission engine plus a **bank bulk-payout (GIRO) file**. Every associate self-serves from a single login; each Sales Manager / Sales Director gets a dashboard scoped strictly to their own downline. Only **Approved + Active** associates flow into sales, payouts, contacts, and dashboards.

---

## Feature overview

- **Recruitment + e-sign onboarding** → Associate Master (HR) record, auto ID `EN####`, forced first-login photo.
- **Sales submission** with add-on commission codes ("com codes") and product upgrades/cascades.
- **Accounts/HR verification** → authoritative Sales Transactions with an immutable upline snapshot.
- **Commission Structure** — per-product, versioned by effective date; internal vs external products.
- **Invoicing & installments** — multi-company, computer-generated & signature invoices, Outstanding tab, Mark-as-Paid, auto installment schedules.
- **Auto commission engine** — installment-aware, idempotent, manual-override fallback.
- **Commission ledger + monthly payouts** — status workflow, payout statement PDFs, **bank GIRO bulk-payout file**.
- **Dashboards** — Personal / Manager / Director / Admin, downline-scoped.
- **Notices**, **Documents & Agreements repository**, **Vendor Referral Registry** (view-only), **Contacts export** (Google-Contacts CSV).
- **Deferred (specced, off in v1):** payment gateway, festive/AI DM generator, separate Vendor/Logistics LMS.

---

## Tech stack

- **Frontend:** Next.js 14+ (App Router) + React + TypeScript + Tailwind + shadcn/ui
- **Backend:** Next.js server actions / route handlers
- **Database:** PostgreSQL 15+ with **Prisma** (UUID PKs, money as `NUMERIC(14,2)` SGD)
- **Auth:** NextAuth (Auth.js) — email/password + role claims, HTTP-only cookie sessions
- **File storage:** S3-compatible (S3 / R2 / Supabase Storage), signed-URL access
- **PDF generation:** server-side (`@react-pdf/renderer` or Puppeteer) for invoices, statements, agreements
- **Background jobs:** scheduled/queued runner for commission runs, payout/bank-file generation, email
- **Hosting:** Vercel + managed Postgres, **ap-southeast-1 (Singapore)** for data residency

---

## Suggested project structure

A single Next.js application (a monorepo is overkill for v1; revisit if the future LMS is co-located):

```
.
├── app/              # Next.js App Router (routes, server actions, route handlers)
├── components/       # Shared UI (shadcn/ui-based)
├── lib/              # Cross-cutting utils: env config, auth, money, encryption, signed URLs
├── server/           # Domain/services: commission engine, invoicing, payouts, RBAC policy
├── jobs/             # Background jobs: commission run, payout/bank-file, email dispatch
├── prisma/           # schema.prisma, migrations, seed.ts
├── docs/             # Design documentation (see "Documentation" below)
├── Enshrine_Portal_PRD.md
└── README.md
```

See `docs/07_Architecture.md` for the full architecture and folder-by-folder rationale.

---

## Prerequisites

- **Node.js** `>= 20` LTS
- **pnpm** `>= 9` (or npm `>= 10`)
- **PostgreSQL** `>= 15` (local or a managed instance in `ap-southeast-1`)
- An **S3-compatible** bucket and an **SMTP** sender for full functionality

Full runtime and environment-variable details: **`docs/06_Environment_Configuration.md`**.

---

## Quick start

```bash
# 1. Clone
git clone <repo-url> enshrine-portal && cd enshrine-portal

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env.local
#   then fill in DATABASE_URL, NEXTAUTH_SECRET, S3_*, PII_ENCRYPTION_KEY, SMTP_*, etc.
#   generate secrets:  openssl rand -base64 32

# 4. Set up the database (migrate + seed prototype data)
pnpm prisma migrate dev
pnpm prisma db seed

# 5. Run the dev server
pnpm dev
#   → http://localhost:3000
```

---

## Common scripts

> Intended scripts (to be defined in `package.json` during the build).

| Script | Purpose |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Run the production build |
| `pnpm lint` | ESLint |
| `pnpm test` | Run the test suite (commission math, eligibility, RBAC, etc.) |
| `pnpm prisma migrate dev` | Apply/create migrations locally |
| `pnpm prisma generate` | Regenerate the Prisma client |
| `pnpm prisma db seed` | Seed prototype data (7 associates, sample companies/products) |
| `pnpm prisma studio` | Inspect the database |

---

## Documentation

The PRD is the source of truth; design docs live in [`docs/`](docs/).

- [`Enshrine_Portal_PRD.md`](Enshrine_Portal_PRD.md) — Product Requirements Document (v1.2)
- [`docs/00_INDEX.md`](docs/00_INDEX.md) — documentation index
- [`docs/01_URD_User_Requirements.md`](docs/01_URD_User_Requirements.md) — User Requirements
- [`docs/02_Database_Diagram.md`](docs/02_Database_Diagram.md) — Database design & ERD
- [`docs/03_Workflow_Diagrams.md`](docs/03_Workflow_Diagrams.md) — Workflow diagrams
- [`docs/04_API_Documentation.md`](docs/04_API_Documentation.md) — API documentation
- [`docs/05_RBAC.md`](docs/05_RBAC.md) — Roles, permissions & data scoping
- [`docs/06_Environment_Configuration.md`](docs/06_Environment_Configuration.md) — Environment & configuration
- [`docs/07_Architecture.md`](docs/07_Architecture.md) — Software Architecture Document

---

## Architecture summary

Client → Next.js app (server actions / route handlers) → Prisma → PostgreSQL, with object storage, email, PDF generation, and a background job runner alongside. Payment gateway and AI services are deferred. Cross-cutting concerns: server-side RBAC + downline scoping ([`docs/05_RBAC.md`](docs/05_RBAC.md)), money as `NUMERIC(14,2)`, PII encryption, audit logging, an idempotent commission engine, and soft-delete. Full details and a diagram: **[`docs/07_Architecture.md`](docs/07_Architecture.md)**.

---

## Deployment

Deploy to **Vercel** with managed PostgreSQL and S3-compatible storage in **ap-southeast-1 (Singapore)** for data residency. Environment variables are configured per environment (Development / Preview / Production); deferred-feature flags stay `false` in staging and production. See [`docs/06_Environment_Configuration.md`](docs/06_Environment_Configuration.md) for the env contract and (when added) the deployment runbook.

---

## Contributing

Until the build begins, changes are limited to the spec and `docs/`. Keep entity, enum, and role names consistent with the PRD and `docs/02_Database_Diagram.md` / `docs/05_RBAC.md`. Use feature branches and clear commits; do not commit secrets or `.env*` files (except `.env.example`).

---

## License

License: TBD (proprietary — © Enshrine). _Placeholder; to be confirmed by the project owner._
