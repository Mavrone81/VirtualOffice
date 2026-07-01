import { z } from "zod";

// Server-side environment contract (see docs/06_Environment_Configuration.md).
// Only import this from server code. Fails fast on misconfiguration.
const bool = z.preprocess((v) => v === "true" || v === true, z.boolean());

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().optional(),
  // 32-byte key as 64 hex chars for AES-256-GCM PII encryption.
  PII_ENCRYPTION_KEY: z.string().min(64),
  PII_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),

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

  PAYMENT_GATEWAY_ENABLED: bool.default(false),
  FESTIVE_AI_ENABLED: bool.default(false),
  GST_ENABLED: bool.default(false),
  GST_RATE: z.coerce.number().default(9),

  TZ: z.string().default("Asia/Singapore"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:", z.treeifyError(parsed.error));
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
