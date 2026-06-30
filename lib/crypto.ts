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

export function decryptPII(blob: string): string {
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

export function maskNric(nric: string | null | undefined): string {
  if (!nric) return "";
  return nric.length >= 5 ? `${nric[0]}••••${nric.slice(-4)}` : "•••••";
}

export function maskAccount(acc: string | null | undefined): string {
  if (!acc) return "";
  return acc.length >= 4 ? `••••${acc.slice(-4)}` : "••••";
}
