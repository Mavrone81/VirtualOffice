// The environment CONTRACT, deliberately separated from the VALIDATION in lib/env.ts.
//
// Why the split: lib/env.ts validates at import and throws, so anything that wants to
// *report on* the contract (the test-run preflight, scripts/check-env-example.mjs) could
// not import it without triggering the very failure it is trying to describe. Keeping the
// schema here, side-effect-free, lets those callers use the REAL schema instead of a second
// copy — a duplicated contract would drift, which is the exact class of bug this file's
// callers exist to catch.
//
// Nothing here reads process.env or throws. Keep it that way.

import { z } from "zod";

// Server-side environment contract (see docs/06_Environment_Configuration.md).
// Only import this from server code. Fails fast on misconfiguration.
const bool = z.preprocess((v) => v === "true" || v === true, z.boolean());

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().optional(),
  // 32-byte key as 64 hex chars for AES-256-GCM PII encryption.
  // 🔴 EXACTLY 64 hex chars, and hex-only. lib/crypto.ts does
  // `Buffer.from(PII_ENCRYPTION_KEY, "hex")` and requires 32 bytes, so:
  //   - `.min(64)` accepted a 96-char key, which decoded to 48 bytes and threw at
  //     module import, AFTER this preflight had passed it. A gate that certifies an
  //     input its consumer rejects turns a clear preflight error into an opaque crash
  //     that cascades as unrelated collection failures.
  //   - length alone is not enough either: `Buffer.from` silently truncates invalid
  //     hex (64 non-hex chars -> 0 bytes, 62 hex + "zz" -> 31 bytes), so a 64-char
  //     non-hex value passes a length check and produces the same wrong buffer.
  PII_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "PII_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)"),
  // Same constraint when present. It was previously unvalidated anywhere — no length
  // check in this schema and none in lib/crypto.ts, which checks only the current key.
  // A malformed previous key therefore failed LATE, at `createDecipheriv` during a PII
  // decrypt (payout-file generation or the HR screen) and only once key rotation
  // actually exercised it, rather than at startup.
  PII_ENCRYPTION_KEY_PREVIOUS: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "PII_ENCRYPTION_KEY_PREVIOUS must be exactly 64 hex characters (32 bytes)")
    .optional(),

  // Local-filesystem object storage root. In prod this is a mounted Docker
  // volume (/data/uploads); in dev it defaults to a repo-relative folder.
  STORAGE_DIR: z.string().default(".uploads"),

  // Transactional email (SMTP). All optional — when unset, mail is logged
  // instead of sent so dev/build/CI work without a relay (see lib/mail.ts).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool.default(false),
  EMAIL_FROM: z.string().default("Enshrine Virtual Office <no-reply@enshrine.com.sg>"),
  EMAIL_REPLY_TO: z.string().optional(),

  INVOICE_NUMBER_FORMAT: z.string().default("INV-{COMPANY}-{YYYY}-{SEQ}"),
  INVOICE_MODE: z.enum(["per-company", "consolidated"]).default("per-company"),
  COMMISSION_PAYOUT_INSTALLMENT_THRESHOLD: z.coerce.number().int().default(3),
  OVERRIDE_CHAIN_DEPTH: z.coerce.number().int().default(2),
  // M5-CF §3: how runPayouts treats an associate whose unattached net is <= 0.
  // Default `hold` is today's M5 behaviour. The owner switches this to `carry_forward`
  // on 165 (a config change, his go) only after the first CF run in prod is signed
  // off against bank records (§2b). `company_absorbs`/`recover` are not implemented.
  PAYOUT_NET_NEGATIVE_POLICY: z.enum(["hold", "carry_forward", "company_absorbs", "recover"]).default("hold"),

  // Admin AI assistant (chat bubble). Optional — when ANTHROPIC_API_KEY is
  // unset the assistant endpoint returns a friendly "not configured" message
  // instead of failing the build/boot. The key is read server-side only and is
  // never sent to the browser.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-4-8"),

  PAYMENT_GATEWAY_ENABLED: bool.default(false),
  FESTIVE_AI_ENABLED: bool.default(false),
  // A-17 (✚5, design note §9): the new quotation -> closed-deal -> verify
  // flow, OFF until phase 2 (needs SEC-12 deployed + verified first). `bool`
  // above only ever turns true on the exact string "true" — anything unset
  // or unparseable is OFF, never a silent enable.
  A17_CLOSED_DEAL_FLOW: bool.default(false),
  NRIC_RETENTION_DAILY_CAP: z.coerce.number().int().positive().default(200),
  // A-17 §4a (DevLead: the first activation needs the owner's explicit go,
  // like every other prod data write): off means the opportunistic trigger
  // is a no-op and "Run now" is refused. Preview (dry run) is unaffected —
  // it never writes, so the owner can review counts before enabling this.
  NRIC_RETENTION_ENABLED: bool.default(false),
  // Whether Legacy (pre-A-17) rejected rows are in scope at all, separate
  // from the main switch above — Q13/Q15 were decided with the new flow in
  // mind, so a Legacy row is purged only once the owner opts it in too.
  NRIC_RETENTION_INCLUDE_LEGACY: bool.default(false),
  GST_ENABLED: bool.default(false),
  // B-9 (Marketing libraries): build-now-ship-later. The 20 MB upload needs
  // the owner's nginx client_max_body_size override on 165 first (ADR-0002),
  // so the feature stays code-complete but hidden from nav until the owner
  // flips this — off by default so a normal deploy of this branch changes nothing.
  MARKETING_LIBRARY_ENABLED: bool.default(false),
  // ADR-0002 decision 4: total size across every non-archived marketing
  // asset. Admin UI warns at 80%, new uploads are refused at 100%. 2048 MB
  // (2 GB) is a placeholder default pending the owner's actual number —
  // changing it needs no code change, just this env var.
  MARKETING_LIBRARY_SOFT_CAP_MB: z.coerce.number().int().default(2048),
  GST_RATE: z.coerce.number().default(9),

  TZ: z.string().default("Asia/Singapore"),
});

