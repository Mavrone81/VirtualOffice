import { describe, it, expect, vi, beforeEach } from "vitest";

const { decryptRawMock, logAuditMock } = vi.hoisted(() => ({
  decryptRawMock: vi.fn(),
  logAuditMock: vi.fn(),
}));
vi.mock("@/lib/crypto", () => ({ decryptPiiRaw: decryptRawMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { decryptPiiAudited, readNric } from "@/server/pii";

beforeEach(() => {
  decryptRawMock.mockReset();
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined);
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
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: "decrypt_pii", entityType: "Associate", entityId: "a1",
      after: { field: "nric" }, actorUserId: "u9",
    });
  });

  it("returns null and does not audit when the raw decrypt throws", async () => {
    decryptRawMock.mockImplementation(() => { throw new Error("bad ciphertext"); });
    expect(await decryptPiiAudited({ blob: "v1:bad", field: "bankAccount", subjectType: "Candidate", subjectId: "c1" })).toBeNull();
    expect(logAuditMock).not.toHaveBeenCalled();
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
      action: "pii.plaintext_read", entityType: "VendorReferral", entityId: "v2", after: { field: "vendorSignerNric" }, actorUserId: undefined,
    });
  });

  it("Low/Architect: throws (never returns null / a blank NRIC) when a v1: blob fails to decrypt", async () => {
    decryptRawMock.mockImplementation(() => { throw new Error("bad ciphertext"); });
    await expect(readNric({ blob: "v1:corrupt", field: "companyWitnessNric", subjectType: "PetsAshesAgreement", subjectId: "p2" }))
      .rejects.toThrow(/failed to decrypt companyWitnessNric/);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
