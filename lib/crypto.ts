import crypto from "node:crypto";
import { env } from "./env";

// AES-256-GCM column encryption for C3 PII (NRIC, bank account number).
// Stored format: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>".
// Decryption is only invoked at payout-file generation and the Admin/Accounts
// HR screen, and every decrypt is audit-logged as `decrypt_pii` by the caller.

const KEY = Buffer.from(env.PII_ENCRYPTION_KEY, "hex");
const KEY_PREV = env.PII_ENCRYPTION_KEY_PREVIOUS
  ? Buffer.from(env.PII_ENCRYPTION_KEY_PREVIOUS, "hex")
  : null;

if (KEY.length !== 32) {
  throw new Error("PII_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
}

export function encryptPII(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptPiiRaw(blob: string): string {
  const [version, ivB, tagB, dataB] = blob.split(":");
  if (version !== "v1" || !ivB || !tagB || !dataB) {
    throw new Error("Malformed PII ciphertext");
  }
  const iv = Buffer.from(ivB, "base64");
  const tag = Buffer.from(tagB, "base64");
  const data = Buffer.from(dataB, "base64");
  for (const key of [KEY, KEY_PREV]) {
    if (!key) continue;
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      /* try previous key */
    }
  }
  throw new Error("PII decryption failed");
}

/**
 * SEC-12: decrypt using ONLY the current key — no PII_ENCRYPTION_KEY_
 * PREVIOUS fallback. `decryptPiiRaw`'s dual-key tolerance is for reading old
 * data during a key rotation; this backs the pre-apply canary, which
 * confirms the CURRENT key specifically, since `encryptPII` (and so the
 * backfill) always writes with the current key.
 */
export function decryptPiiCurrentKeyOnly(blob: string): string {
  const [version, ivB, tagB, dataB] = blob.split(":");
  if (version !== "v1" || !ivB || !tagB || !dataB) {
    throw new Error("Malformed PII ciphertext");
  }
  const iv = Buffer.from(ivB, "base64");
  const tag = Buffer.from(tagB, "base64");
  const data = Buffer.from(dataB, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** A real value can never collide with the ciphertext prefix (SEC-12, P-1). */
export class LooksLikeEncryptedError extends Error {}

/** Encrypt a NRIC/FIN-shaped field for storage, or null when blank. Throws
 *  LooksLikeEncryptedError if the raw input itself starts with the ciphertext
 *  prefix (SEC-12) — callers should map that to a validation error. */
export function encryptNric(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (v.startsWith("v1:")) throw new LooksLikeEncryptedError();
  return encryptPII(v);
}

export function maskNric(nric: string | null | undefined): string {
  if (!nric) return "";
  return nric.length >= 5 ? `${nric[0]}••••${nric.slice(-4)}` : "•••••";
}

export function maskAccount(acc: string | null | undefined): string {
  if (!acc) return "";
  return acc.length >= 4 ? `••••${acc.slice(-4)}` : "••••";
}
