import { describe, it, expect, vi, beforeEach } from "vitest";

const { decryptRawMock, logAuditMock } = vi.hoisted(() => ({
  decryptRawMock: vi.fn(),
  logAuditMock: vi.fn(),
}));
vi.mock("@/lib/crypto", () => ({ decryptPiiRaw: decryptRawMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { decryptPiiAudited } from "@/server/pii";

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
