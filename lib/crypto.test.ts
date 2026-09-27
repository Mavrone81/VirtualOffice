import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { encryptPII, decryptPiiRaw, decryptPiiCurrentKeyOnly, encryptNric, LooksLikeEncryptedError, maskNric } from "./crypto";

/** Encrypts with an arbitrary key, bypassing lib/crypto's configured KEY —
 *  stands in for "a ciphertext this key was never used to write." */
function encryptWithKey(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

describe("encryptNric (SEC-12)", () => {
  it("encrypts a real value to the v1: ciphertext format and round-trips", () => {
    const blob = encryptNric("S1234567A");
    expect(blob).not.toBeNull();
    expect(blob!.startsWith("v1:")).toBe(true);
    expect(decryptPiiRaw(blob!)).toBe("S1234567A");
  });

  it("returns null for blank/whitespace-only input, same as the associate pattern", () => {
    expect(encryptNric(undefined)).toBeNull();
    expect(encryptNric(null)).toBeNull();
    expect(encryptNric("")).toBeNull();
    expect(encryptNric("   ")).toBeNull();
  });

  it("trims before encrypting", () => {
    const blob = encryptNric("  S1234567A  ")!;
    expect(decryptPiiRaw(blob)).toBe("S1234567A");
  });

  it("P-1: rejects a user-typed value that itself starts with the ciphertext prefix", () => {
    // Keeps every real value distinguishable from ciphertext for the
    // backfill's `NOT LIKE 'v1:%'` guard.
    expect(() => encryptNric("v1:not-really-ciphertext")).toThrow(LooksLikeEncryptedError);
    // A real ciphertext blob is also rejected as fresh "plaintext" input —
    // that's intentional: this function is for encrypting NEW user input, never
    // for re-wrapping an already-encrypted value.
    const real = encryptPII("S1234567A");
    expect(() => encryptNric(real)).toThrow(LooksLikeEncryptedError);
  });
});

describe("decryptPiiCurrentKeyOnly (S1/Architect)", () => {
  it("round-trips a value encrypted with the configured (current) key", () => {
    const blob = encryptPII("S1234567A");
    expect(decryptPiiCurrentKeyOnly(blob)).toBe("S1234567A");
  });

  it("throws (never falls back) for a ciphertext written with a DIFFERENT key", () => {
    const wrongKey = Buffer.from("b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2", "hex");
    const blob = encryptWithKey("S1234567A", wrongKey);
    expect(() => decryptPiiCurrentKeyOnly(blob)).toThrow();
  });
});

describe("maskNric (unchanged, sanity)", () => {
  it("masks a decrypted value for display", () => {
    expect(maskNric("S1234567A")).toBe("S••••567A");
    expect(maskNric(null)).toBe("");
  });
});
