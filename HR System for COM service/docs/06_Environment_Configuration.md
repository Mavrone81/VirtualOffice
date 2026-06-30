# Environment & Configuration — Enshrine Associate Management Portal

**Version:** 1.0 · **Source of truth:** `Enshrine_Portal_PRD.md` v1.5 (§4, §10, §13) · **Anchors:** `02_Database_Diagram.md`, `05_RBAC.md`
**Region:** Singapore — managed Postgres + object storage in **ap-southeast-1** for data residency.

> Status: spec/PRD stage — to be built by Codex. This document defines the runtime contract (environment variables, secrets, and per-environment differences) the application must read at boot. Implement variable parsing with a single validated config module (e.g. `lib/env.ts` using `zod`) so missing/invalid values fail fast at startup.

---

## 1. Runtime prerequisites

| Component | Version / requirement | Notes |
|---|---|---|
| **Node.js** | `>= 20.x LTS` (Node 20 or 22) | Required by Next.js 14+ App Router. Pin via `.nvmrc` / `engines`. |
| **Package manager** | **pnpm `>= 9`** (recommended); npm `>= 10` acceptable | Lockfile committed. Examples in this repo assume `pnpm`. |
| **PostgreSQL** | `>= 15` | Prisma target engine. Managed instance (Supabase / Neon / RDS) in `ap-southeast-1`. |
| **Prisma CLI** | matches `prisma` dependency in `package.json` | `prisma migrate`, `prisma generate`, `prisma db seed`. |
| **Object storage** | S3-compatible (AWS S3 / Cloudflare R2 / Supabase Storage) | Singapore region; private bucket, signed-URL access only. |
| **SMTP / email** | Any SMTP relay or transactional API (SES / Postmark / Resend) | For notices, approvals, payout-paid notifications. |
| **OpenSSL / libsodium** | available at runtime | For PII field encryption (NRIC / bank account). |

The app must run with `TZ=Asia/Singapore` (see §3 timezone note). Money is `NUMERIC(14,2)` SGD — no float config needed, but `Intl`/locale defaults should assume `en-SG`.

---

## 2. Environment variable reference

All variables are read at server start. **Never** prefix secrets with `NEXT_PUBLIC_` — only values explicitly safe for the browser may use that prefix. Required variables must be present in every environment or the app refuses to boot.

| Variable | Example | Required? | Description |
|---|---|---|---|
| `NODE_ENV` | `production` | Yes | `development` \| `test` \| `production`. Drives framework behaviour. |
| `TZ` | `Asia/Singapore` | Yes | Process timezone. Store UTC in DB; render Asia/Singapore. |
| `APP_BASE_URL` | `https://portal.enshrine.sg` | Yes | Canonical public base URL of the app (used in emails, PDF links, redirects). |
| **Database** | | | |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/enshrine?schema=public&sslmode=require` | Yes | Prisma connection string. Use the pooled URL for serverless (Vercel). |
| `DIRECT_URL` | `postgresql://user:pass@host:5432/enshrine?schema=public&sslmode=require` | Yes (if pooling) | Non-pooled direct connection for `prisma migrate`/introspection. |
| **Auth (NextAuth / Auth.js)** | | | |
| `NEXTAUTH_URL` | `https://portal.enshrine.sg` | Yes | Canonical URL NextAuth uses for callbacks/cookies. Equals `APP_BASE_URL`. |
| `NEXTAUTH_SECRET` | `base64:9f3c…` (32+ bytes) | Yes | Signs/encrypts session JWTs & cookies. Generate with `openssl rand -base64 32`. |
| `AUTH_TRUST_HOST` | `true` | Prod (Vercel) | Allow Auth.js to trust the deploy host header. |
| `AUTH_GOOGLE_ID` | `1234567890-abc.apps.googleusercontent.com` | No | OAuth provider client ID (if Google SSO enabled; v1 default = email/password). |
| `AUTH_GOOGLE_SECRET` | `GOCSPX-…` | No | OAuth provider client secret (paired with above). |
| **Object / file storage (S3-compatible)** | | | |
| `S3_ENDPOINT` | `https://s3.ap-southeast-1.amazonaws.com` | Yes | Endpoint (omit/region-derived for AWS; required for R2/Supabase). |
| `S3_REGION` | `ap-southeast-1` | Yes | Storage region — **must be Singapore** for residency. |
| `S3_BUCKET` | `enshrine-portal-prod` | Yes | Bucket for agreements, invoices, signed docs, photos. |
| `S3_ACCESS_KEY_ID` | `AKIA…` | Yes | Storage access key. |
| `S3_SECRET_ACCESS_KEY` | `wJalr…` | Yes | Storage secret key. |
| `S3_FORCE_PATH_STYLE` | `true` | No | Set `true` for R2/MinIO/Supabase path-style addressing. |
| `S3_SIGNED_URL_TTL` | `300` | No | Signed-URL lifetime in seconds (default 5 min). |
| **PII encryption** | | | |
| `PII_ENCRYPTION_KEY` | `base64:0a1b…` (32 bytes / 256-bit) | Yes | AES-256-GCM key encrypting `nric` & `bank_account_number` at rest. Generate `openssl rand -base64 32`. |
| `PII_ENCRYPTION_KEY_PREVIOUS` | `base64:…` | No | Previous key, retained during key rotation for decrypt-only. |
| **Email / SMTP** | | | |
| `SMTP_HOST` | `email-smtp.ap-southeast-1.amazonaws.com` | Yes | SMTP relay host. |
| `SMTP_PORT` | `587` | Yes | `587` (STARTTLS) or `465` (TLS). |
| `SMTP_USER` | `AKIA…` | Yes | SMTP username. |
| `SMTP_PASSWORD` | `BG…` | Yes | SMTP password / API key. |
| `SMTP_SECURE` | `false` | No | `true` for port 465 implicit TLS. |
| `EMAIL_FROM` | `Enshrine Portal <no-reply@enshrine.sg>` | Yes | Default From header for transactional mail. |
| `EMAIL_REPLY_TO` | `ops@enshrine.sg` | No | Reply-To for notices/approvals. |
| **Invoice numbering** | | | |
| `INVOICE_NUMBER_FORMAT` | `INV-{COMPANY}-{YYYY}-{SEQ}` | No | Template per PRD §6.5b. `{SEQ}` zero-padded. Per-company sequence sourced from `companies.invoice_next_seq`. |
| `INVOICE_SEQ_PADDING` | `5` | No | Zero-pad width for `{SEQ}` (e.g. `00042`). |
| `INVOICE_DEFAULT_MODE` | `per-company` | No | `per-company` (default) or `consolidated` (PRD §6.5b [DECISION NEEDED]). |
| **Commission / payout config** | | | |
| `COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD` | `3` | No | Default installment milestone that makes commission payable (PRD §8.3). |
| `OVERRIDE_CHAIN_DEPTH` | `2` | No | Upline override depth (PRD §8.1 default = direct + 2nd upline). |
| **Feature flags** | | | |
| `PAYMENT_GATEWAY_ENABLED` | `false` | Yes | Deferred (PRD §1.3). Keep `false` in v1; payments recorded manually. |
| `FESTIVE_AI_ENABLED` | `false` | Yes | Deferred festive/DM AI generator (PRD §6.12). `false` ships static templates only. |
| `GST_ENABLED` | `false` | Yes | GST-ready but off until revenue ≥ SGD 1M (PRD §1.3, §6.5). |
| `GST_RATE` | `9` | No | GST percentage applied only when `GST_ENABLED=true`. |
| **Observability (optional)** | | | |
| `SENTRY_DSN` | `https://…@…ingest.sentry.io/…` | No | Error tracking (PRD §10 observability). |
| `LOG_LEVEL` | `info` | No | `debug` \| `info` \| `warn` \| `error`. |

> **Browser-exposed values:** if any config must reach the client (e.g. public app name), expose a deliberate `NEXT_PUBLIC_APP_NAME` rather than leaking server vars. No secret listed above may carry the `NEXT_PUBLIC_` prefix.

---

## 3. Timezone note

- Store all timestamps in **UTC** (`timestamptz`), render in **Asia/Singapore** (UTC+8, no DST) per `02_Database_Diagram.md`.
- Set `TZ=Asia/Singapore` on the server process so date-only fields (`sales_date`, `payout_month`, invoice dates) and cron/job boundaries resolve to Singapore civil time.
- `payout_month` (`YYYY-MM`) and installment due dates are computed against Singapore time.

---

## 4. Sample `.env.example`

```dotenv
# ── Core ───────────────────────────────────────────────
NODE_ENV=development
TZ=Asia/Singapore
APP_BASE_URL=http://localhost:3000

# ── Database (PostgreSQL 15+) ──────────────────────────
DATABASE_URL=postgresql://enshrine:password@localhost:5432/enshrine?schema=public
DIRECT_URL=postgresql://enshrine:password@localhost:5432/enshrine?schema=public

# ── Auth (NextAuth / Auth.js) ──────────────────────────
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-`openssl rand -base64 32`
AUTH_TRUST_HOST=true
# Optional OAuth (v1 default is email/password)
# AUTH_GOOGLE_ID=
# AUTH_GOOGLE_SECRET=

# ── Object storage (S3-compatible, Singapore) ──────────
S3_ENDPOINT=https://s3.ap-southeast-1.amazonaws.com
S3_REGION=ap-southeast-1
S3_BUCKET=enshrine-portal-local
S3_ACCESS_KEY_ID=replace-me
S3_SECRET_ACCESS_KEY=replace-me
S3_FORCE_PATH_STYLE=false
S3_SIGNED_URL_TTL=300

# ── PII encryption (NRIC / bank account) ───────────────
PII_ENCRYPTION_KEY=replace-with-`openssl rand -base64 32`
# PII_ENCRYPTION_KEY_PREVIOUS=

# ── Email / SMTP ───────────────────────────────────────
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_USER=replace-me
SMTP_PASSWORD=replace-me
SMTP_SECURE=false
EMAIL_FROM=Enshrine Portal <no-reply@enshrine.sg>
EMAIL_REPLY_TO=ops@enshrine.sg

# ── Invoice numbering ──────────────────────────────────
INVOICE_NUMBER_FORMAT=INV-{COMPANY}-{YYYY}-{SEQ}
INVOICE_SEQ_PADDING=5
INVOICE_DEFAULT_MODE=per-company

# ── Commission / payout ────────────────────────────────
COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD=3
OVERRIDE_CHAIN_DEPTH=2

# ── Feature flags (deferred items OFF in v1) ───────────
PAYMENT_GATEWAY_ENABLED=false
FESTIVE_AI_ENABLED=false
GST_ENABLED=false
GST_RATE=9

# ── Observability (optional) ───────────────────────────
# SENTRY_DSN=
LOG_LEVEL=info
```

> Commit `.env.example` (no real secrets). Never commit `.env`, `.env.local`, or `.env.*.local` — they are git-ignored.

---

## 5. Environments (local / staging / production)

| Concern | Local (`development`) | Staging | Production |
|---|---|---|---|
| Host | localhost:3000 | Vercel preview/staging project | Vercel production project |
| `DATABASE_URL` | local Postgres or a disposable cloud DB | dedicated staging DB (ap-southeast-1) | managed prod DB (ap-southeast-1), pooled URL |
| Storage bucket | `enshrine-portal-local` | `enshrine-portal-staging` | `enshrine-portal-prod` (private) |
| Email | Mailpit/Mailhog or sandbox SMTP | sandboxed sender, restricted recipients | live transactional sender, verified domain |
| Secrets source | `.env.local` (developer machine) | Vercel env (Preview scope) | Vercel env (Production scope) + secret manager |
| Feature flags | flags may be toggled for testing | mirror prod (`*_ENABLED=false`) | `PAYMENT_GATEWAY_ENABLED=false`, `FESTIVE_AI_ENABLED=false`, `GST_ENABLED=false` |
| Seed data | full prototype seed (7 associates, sample products) | sanitized/synthetic data only | no test data; real records only |
| Logging | verbose (`debug`) | `info` + Sentry | `info` + Sentry, no PII in logs |

Key differences: production uses the **pooled** `DATABASE_URL` (serverless) plus `DIRECT_URL` for migrations; staging mirrors prod flag values so deferred features stay disabled; local may enable flags only to exercise stubbed code paths.

---

## 6. Secrets management

- **Never commit secrets.** `.env*` (except `.env.example`) is git-ignored. Rotate any secret that lands in version control or logs.
- **Vercel:** store all secrets as Encrypted Environment Variables, scoped per environment (Development / Preview / Production). Do not reuse the same `NEXTAUTH_SECRET`, `PII_ENCRYPTION_KEY`, or DB credentials across environments.
- **Generation:** `NEXTAUTH_SECRET` and `PII_ENCRYPTION_KEY` via `openssl rand -base64 32` (256-bit). Storage/SMTP keys issued from their providers with least-privilege scopes (the S3 key needs only the single bucket).
- **PII key rotation:** introduce a new `PII_ENCRYPTION_KEY`, keep the old one as `PII_ENCRYPTION_KEY_PREVIOUS` for decrypt-only, re-encrypt rows in a background job, then retire the old key. Access to decrypted NRIC/bank fields is restricted to Admin/Accounts and audit-logged (`05_RBAC.md` §4).
- **Validation at boot:** parse and validate all required vars in one config module; fail fast with a clear error listing missing/invalid keys.
- **Audit:** secret access patterns and privileged config changes should be observable; never log secret values or decrypted PII.

---

## 7. Data-residency note (Singapore / PDPA)

Per PRD §10 and §4, this is a Singapore business handling NRIC, bank, and PDPA-regulated personal data:

- **All data at rest stays in Singapore (`ap-southeast-1`):** the managed Postgres instance, the S3-compatible bucket, and any backups must be provisioned in the Singapore region.
- **Object storage** is private; files served only via short-lived signed URLs (`S3_SIGNED_URL_TTL`).
- **PII columns** (`nric`, `bank_account_number`) are encrypted at rest with `PII_ENCRYPTION_KEY` and masked in the UI for non-Admin/Accounts roles.
- **Email/SMTP** routing should likewise prefer a Singapore/Asia regional endpoint where the provider offers one.
- Consent is captured at recruitment; retention and access/erasure tooling are required (PRD §10). Avoid configuring any sub-processor that stores PII outside Singapore without explicit review.
