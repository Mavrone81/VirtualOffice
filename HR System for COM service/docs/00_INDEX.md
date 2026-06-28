# Documentation Index — Enshrine Associate Management Portal

**Product:** Enshrine Associate Management Portal — a CRM + HRMS "virtual office" for a Singapore funeral-services and pet-aftercare business.
**Stack:** Next.js (App Router, TypeScript) + PostgreSQL + Prisma + NextAuth/Auth.js + S3-compatible storage; Vercel + managed Postgres in ap-southeast-1 (Singapore).
**Target builder:** Codex (autonomous code generation).

> **Source of truth:** `Enshrine_Portal_PRD.md` (v1.2) is the **master specification** — when any doc disagrees, the PRD wins. `docs/05_RBAC.md` is the **canonical reference for roles, permissions, and data scoping**, and `docs/02_Database_Diagram.md` is the **canonical reference for entities, columns, and enums**. All other docs reference these.

---

## 1. Document map

| # | Document | One-line description | Intended reader |
|---|---|---|---|
| — | `Enshrine_Portal_PRD.md` (root) | **Master PRD v1.2** — tech stack, full data model, commission engine logic (§8), RBAC, screen-by-screen requirements, acceptance criteria (§14), phased plan. | Everyone; Codex (primary build spec) |
| — | `README.md` (root) | Project overview, purpose, feature summary, current status (spec stage). | New contributors; orientation |
| — | `TESTING.md` (root) | **Comprehensive test suite (Phase 3)** — unit/integration/E2E strategy, full test inventory, run commands, coverage, acceptance traceability. | QA, builder, Codex |
| 00 | `docs/00_INDEX.md` | This index — document map, reading order, source-of-truth note. | Everyone starting out |
| 01 | `docs/01_URD_User_Requirements.md` | User Requirements Document — personas, user stories, what each role needs. | Product, QA, builder |
| 02 | `docs/02_Database_Diagram.md` | **Database design & ERD (canonical entities/enums)** — Mermaid ERD, table-by-table data dictionary, enumerated types, indexes/integrity. | Backend / DB, Codex |
| 03 | `docs/03_Workflow_Diagrams.md` | Process/workflow diagrams — recruitment, sales→verify→invoice→engine→payout pipeline, installment/eligibility flows. | Builder, QA, product |
| 04 | `docs/04_API_Documentation.md` | API / server-action endpoint reference with role + scope mappings. | Backend / frontend integration |
| 05 | `docs/05_RBAC.md` | **Role-Based Access Control (canonical roles/scoping)** — roles, permission matrix, downline-closure scoping, enforcement, §6 test cases. | Backend, security, QA |
| 06 | `docs/06_Environment_Configuration.md` | Environment variables & configuration reference (`.env` keys, feature flags, per-env config). | DevOps, builder |
| 07 | `docs/07_Architecture.md` | Software architecture — components, layering, data flow, key technical decisions. | Architects, builder |
| 08 | `docs/08_Security_and_PDPA.md` | Singapore PDPA compliance + app security — data classification, encryption/masking, consent, residency, retention/erasure, OWASP checklist, financial guardrails. | Security, DevOps, ops/DPO |
| 09 | `docs/09_Test_Plan.md` | QA strategy — test levels/tooling, commission-engine unit tests, RBAC/data-integrity matrices, §14 traceability, entry/exit criteria, UAT checklist. | QA, builder |
| 10 | `docs/10_Deployment_Runbook.md` | DevOps/deployment — managed (Vercel) pipeline **and §11–14 the live self-hosted server-pull CI/CD** (server `165.22.246.45`, repo `VirtualOffice`): connection details, recon checklist, local→GitHub push runbook, `.gitignore` template, auto-deploy script + cron. | DevOps, builder |
| 11 | `docs/11_Coding_Standards.md` | Coding conventions — TS strictness, naming, money/date handling, validation, API/component patterns, commit/PR, definition of done. | Builder (all engineers), Codex |

---

## 2. Recommended reading order (for someone — or Codex — starting the build)

1. **`README.md`** — orient: what the product is and its current status.
2. **`Enshrine_Portal_PRD.md`** — the master spec; read end to end (note §8 engine, §10 NFRs, §14 acceptance).
3. **`docs/01_URD_User_Requirements.md`** — who the users are and what they need.
4. **`docs/05_RBAC.md`** — roles, permissions, and scoping (read before building any data access).
5. **`docs/02_Database_Diagram.md`** — the schema, enums, and integrity rules to model in Prisma.
6. **`docs/07_Architecture.md`** — how the pieces fit together.
7. **`docs/03_Workflow_Diagrams.md`** — the end-to-end process flows.
8. **`docs/04_API_Documentation.md`** — the endpoints/server actions to implement.
9. **`docs/11_Coding_Standards.md`** — conventions to write the code by.
10. **`docs/06_Environment_Configuration.md`** + **`docs/10_Deployment_Runbook.md`** — configure environments and the deploy pipeline (incl. §11–14 the live server-pull CI/CD: push local→GitHub→server auto-deploy).
11. **`docs/08_Security_and_PDPA.md`** — apply security/PDPA controls throughout.
12. **`docs/09_Test_Plan.md`** (strategy) + **`TESTING.md`** (full suite/inventory) — verify against acceptance criteria and the commission worked example.

---

## 3. Source artifacts (inputs that the PRD reconciles)

These are the raw inputs behind the spec (PRD §0). They are background/evidence, not build instructions — the PRD is the reconciled source of truth.

| Artifact | What it is |
|---|---|
| `Enshrine Management Portal.pdf` | The 8-module pipeline design **deck**. |
| `Enshrine Associate Management System.xlsx` | The existing **Google Sheets + Forms prototype** (HR layer populated; downstream sheets empty) — source of the live enums and the 7 seed associates. |
| `MicrosoftTeams-video-transcript.txt` | ~71-minute **walkthrough** between Samuel and the client — source of invoicing, installment-driven commission, com codes, notices, documents, e-sign, vendor registry, bank-payout file. |
| `MicrosoftTeams-video-translation-EN.txt` | Clean **English translation** of the walkthrough. |
| `Meeting-Minutes-Enshrine-Portal.md` | Structured **meeting minutes** — added external-product commission treatment, manual override fallback, brand/product-category names, and relative priorities. |

---

*Master spec: `Enshrine_Portal_PRD.md` v1.2. Canonical role/scope authority: `docs/05_RBAC.md`. Canonical entity/enum authority: `docs/02_Database_Diagram.md`.*
