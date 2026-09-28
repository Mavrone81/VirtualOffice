// A-17 §Q6: addSubmissionRequiredDocument — validates requirementKey against
// resolveProductDocGate's CURRENT read (same rule verifySale/getVerifyChecklist
// use), then stores the file + row + audit in one transaction (Tier A).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, putObjectMock, deleteObjectMock, assertMock, auditTxMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    salesSubmission: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
    submissionDocument: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  putObjectMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  assertMock: vi.fn(),
  auditTxMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ putObject: putObjectMock, getObject: vi.fn(), deleteObject: deleteObjectMock }));
vi.mock("@/lib/file-type", () => ({ assertUpload: assertMock }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), auditTx: auditTxMock }));
// MD B2: addSubmissionRequiredDocument now refuses outright when the flag is
// off (a separate, dedicated test covers that refusal) — this file tests the
// feature's own real behaviour, which only exists with the flag on.
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), env: { ...(await orig<typeof import("@/lib/env")>()).env, A17_CLOSED_DEAL_FLOW: true } }));

import { AuditWriteError } from "@/lib/audit";
import { addSubmissionRequiredDocument } from "@/server/sales/actions";

const PDF = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "contract.pdf");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (db: typeof prismaMock) => unknown) => fn(prismaMock));
  prismaMock.submissionDocument.create.mockResolvedValue({});
  putObjectMock.mockResolvedValue(undefined);
  deleteObjectMock.mockResolvedValue(undefined);
  assertMock.mockReturnValue("pdf");
  auditTxMock.mockResolvedValue(undefined);
  prismaMock.product.findMany.mockResolvedValue([
    { productCode: "DOC", requiredDocuments: [{ key: "contract" }], requiresAshesAgreement: false },
  ]);
  prismaMock.salesSubmission.findUnique.mockResolvedValue({
    closingAssociateId: "closer1",
    lineItems: [{ productCode: "DOC" }],
  });
});

describe("addSubmissionRequiredDocument", () => {
  it("stores the file, writes the row and audits it in one transaction, for the closing associate", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const r = await addSubmissionRequiredDocument("sub1", "contract", PDF);
    expect(r).toEqual({ ok: true });
    expect(prismaMock.submissionDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submissionId: "sub1", requirementKey: "contract", fileName: "contract.pdf" }) }),
    );
    expect(auditTxMock).toHaveBeenCalledWith(prismaMock, expect.objectContaining({ action: "sale.required_document_added", entityId: "sub1", after: { requirementKey: "contract" } }));
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it("allows an admin regardless of associateId", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", id: "admin1", associateId: null } });
    const r = await addSubmissionRequiredDocument("sub1", "contract", PDF);
    expect(r).toEqual({ ok: true });
  });

  it("refuses a different associate", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "other1", associateId: "other1" } });
    const r = await addSubmissionRequiredDocument("sub1", "contract", PDF);
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.submissionDocument.create).not.toHaveBeenCalled();
  });

  it("refuses signed-out callers", async () => {
    authMock.mockResolvedValue(null);
    const r = await addSubmissionRequiredDocument("sub1", "contract", PDF);
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses a missing submission", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue(null);
    const r = await addSubmissionRequiredDocument("nope", "contract", PDF);
    expect(r).toEqual({ ok: false, error: "notFound" });
  });

  it("refuses a key that isn't one of the sale's products' CURRENT required keys", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const r = await addSubmissionRequiredDocument("sub1", "not-a-real-key", PDF);
    expect(r).toEqual({ ok: false, error: "invalidRequirementKey" });
    expect(putObjectMock).not.toHaveBeenCalled();
    expect(prismaMock.submissionDocument.create).not.toHaveBeenCalled();
  });

  it("refuses a key that was retired from the product since submission", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { productCode: "DOC", requiredDocuments: [], requiresAshesAgreement: false }, // key removed
    ]);
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const r = await addSubmissionRequiredDocument("sub1", "contract", PDF);
    expect(r).toEqual({ ok: false, error: "invalidRequirementKey" });
  });

  it("refuses when one of the sale's products can no longer be found", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const r = await addSubmissionRequiredDocument("sub1", "contract", PDF);
    expect(r).toEqual({ ok: false, error: "invalidRequirementKey" });
  });

  it("rejects an empty file", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const empty = new File([], "");
    const r = await addSubmissionRequiredDocument("sub1", "contract", empty);
    expect(r).toEqual({ ok: false, error: "fileRequired" });
  });

  it("rejects a file over the size cap", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const big = new File([new Uint8Array(15_000_001)], "big.pdf");
    const r = await addSubmissionRequiredDocument("sub1", "contract", big);
    expect(r).toEqual({ ok: false, error: "fileTooLarge" });
    expect(prismaMock.submissionDocument.create).not.toHaveBeenCalled();
  });

  it("rejects a file that fails magic-byte sniffing", async () => {
    assertMock.mockImplementation(() => { throw new Error("BAD_UPLOAD_TYPE"); });
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const fake = new File([new Uint8Array([0x00, 0x01])], "fake.exe");
    const r = await addSubmissionRequiredDocument("sub1", "contract", fake);
    expect(r).toEqual({ ok: false, error: "invalidFileType" });
    expect(prismaMock.submissionDocument.create).not.toHaveBeenCalled();
  });

  it("adds another row on a re-upload of the same key (append-only)", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    await addSubmissionRequiredDocument("sub1", "contract", PDF);
    await addSubmissionRequiredDocument("sub1", "contract", PDF);
    expect(prismaMock.submissionDocument.create).toHaveBeenCalledTimes(2);
  });

  it("removes the stored file and reports auditUnavailable when the audit write fails", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    auditTxMock.mockRejectedValue(new AuditWriteError("sale.required_document_added", new Error("db down")));
    const r = await addSubmissionRequiredDocument("sub1", "contract", PDF);
    expect(r).toEqual({ ok: false, error: "auditUnavailable" });
    expect(deleteObjectMock).toHaveBeenCalledTimes(1);
  });
});
