import { describe, it, expect, vi, beforeEach } from "vitest";

// Audit-before-reveal (reviews/audit-reliability.md): the access is recorded
// through auditTx FIRST; if that throws, nothing is decrypted or returned.
const { decryptRawMock, logAuditMock, order } = vi.hoisted(() => ({
  decryptRawMock: vi.fn(),
  logAuditMock: vi.fn(),
  order: [] as string[],
}));
vi.mock("@/lib/crypto", () => ({ decryptPiiRaw: (b: string) => { order.push("decrypt"); return decryptRawMock(b); } }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), auditTx: (_db: unknown, e: unknown) => { order.push("audit"); return logAuditMock(e); } }));

import { decryptPiiAudited, readNric, PiiAuditUnavailableError } from "@/server/pii";

beforeEach(() => {
  decryptRawMock.mockReset();
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined);
  order.length = 0;
});

describe("decryptPiiAudited", () => {
  it("returns null and does not audit when the blob is empty", async () => {
    expect(await decryptPiiAudited({ blob: null, field: "nric", subjectType: "Associate", subjectId: "a1" })).toBeNull();
    expect(decryptRawMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("decrypts and writes one decrypt_pii audit row on success", async () => {
    decryptRawMock.mockReturnValue("S1234567D");
    const out = await decryptPiiAudited({
      blob: "v1:x", field: "nric", subjectType: "Associate", subjectId: "a1", actorUserId: "u9",
    });
    expect(out).toBe("S1234567D");
    expect(order).toEqual(["audit", "decrypt"]); // recorded before revealed
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: "decrypt_pii", entityType: "Associate", entityId: "a1",
      after: { field: "nric" }, actorUserId: "u9",
    });
  });

  it("returns null when the raw decrypt throws (the access attempt is still recorded)", async () => {
    decryptRawMock.mockImplementation(() => { throw new Error("bad ciphertext"); });
    expect(await decryptPiiAudited({ blob: "v1:bad", field: "bankAccount", subjectType: "Candidate", subjectId: "c1" })).toBeNull();
    expect(logAuditMock).toHaveBeenCalledTimes(1);
  });

  it("a failed audit throws PiiAuditUnavailableError and never decrypts", async () => {
    logAuditMock.mockRejectedValue(new Error("audit table unwritable"));
    decryptRawMock.mockReturnValue("S1234567D");
    await expect(decryptPiiAudited({ blob: "v1:x", field: "nric", subjectType: "Associate", subjectId: "a1", actorUserId: "u9" }))
      .rejects.toBeInstanceOf(PiiAuditUnavailableError);
    expect(order).toEqual(["audit"]);
  });
});

describe("readNric (SEC-12)", () => {
  it("returns null and does not audit when the blob is empty", async () => {
    expect(await readNric({ blob: null, field: "vendorSignerNric", subjectType: "VendorReferral", subjectId: "v1" })).toBeNull();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("decrypts and audits a decrypt_pii row for a v1: ciphertext", async () => {
    decryptRawMock.mockReturnValue("S1234567D");
    const out = await readNric({ blob: "v1:x", field: "applicant1Nric", subjectType: "PetsAshesAgreement", subjectId: "p1", actorUserId: "u9" });
    expect(out).toBe("S1234567D");
    expect(logAuditMock).toHaveBeenCalledWith({
      action: "decrypt_pii", entityType: "PetsAshesAgreement", entityId: "p1", after: { field: "applicant1Nric" }, actorUserId: "u9",
    });
  });

  it("passes still-plaintext legacy data through and audits pii.plaintext_read (counts only)", async () => {
    const out = await readNric({ blob: "S9988776C", field: "vendorSignerNric", subjectType: "VendorReferral", subjectId: "v2" });
    expect(out).toBe("S9988776C");
    expect(decryptRawMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith({
      action: "pii.plaintext_read", entityType: "VendorReferral", entityId: "v2", after: { field: "vendorSignerNric" }, actorUserId: null, // no actor passed → session lookup (none here)
    });
  });

  it("Low/Architect: throws (never returns null / a blank NRIC) when a v1: blob fails to decrypt", async () => {
    decryptRawMock.mockImplementation(() => { throw new Error("bad ciphertext"); });
    await expect(readNric({ blob: "v1:corrupt", field: "companyWitnessNric", subjectType: "PetsAshesAgreement", subjectId: "p2" }))
      .rejects.toThrow(/failed to decrypt companyWitnessNric/);
    expect(logAuditMock).toHaveBeenCalledTimes(1); // the attempt was recorded first
  });

  it("a failed audit throws PiiAuditUnavailableError on both branches, nothing returned", async () => {
    logAuditMock.mockRejectedValue(new Error("audit table unwritable"));
    decryptRawMock.mockReturnValue("S1234567D");
    await expect(readNric({ blob: "v1:x", field: "applicant1Nric", subjectType: "PetsAshesAgreement", subjectId: "p1", actorUserId: "u9" }))
      .rejects.toBeInstanceOf(PiiAuditUnavailableError);
    await expect(readNric({ blob: "S9988776C", field: "vendorSignerNric", subjectType: "VendorReferral", subjectId: "v2", actorUserId: "u9" }))
      .rejects.toBeInstanceOf(PiiAuditUnavailableError);
    expect(decryptRawMock).not.toHaveBeenCalled();
  });
});
