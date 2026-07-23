import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, putObjectMock, renderMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { salesSubmission: { findUnique: vi.fn() }, submissionDocument: { create: vi.fn() } },
  putObjectMock: vi.fn(),
  renderMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/storage", () => ({ putObject: putObjectMock }));
vi.mock("@/lib/file-type", () => ({ assertUpload: () => "png" }));
vi.mock("@/lib/pdf/quotation", () => ({ renderQuotationPdf: renderMock }));

import { signQuotationOnSystem } from "@/app/portal/quotations/actions";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const approved = { closingAssociateId: "a1", status: "QuotationApproved", transaction: null };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { associateId: "a1", id: "u1" } });
  prismaMock.salesSubmission.findUnique.mockResolvedValue(approved);
  prismaMock.submissionDocument.create.mockResolvedValue({});
  renderMock.mockResolvedValue({ buffer: Buffer.from("pdf"), filename: "Quotation-TXN-1.pdf" });
});

describe("signQuotationOnSystem", () => {
  it("renders + stores the signed quotation as a Signed docket document", async () => {
    const r = await signQuotationOnSystem("s1", PNG, "  Jane Tan  ");
    expect(r.ok).toBe(true);
    expect(renderMock).toHaveBeenCalledWith("s1", expect.objectContaining({ signerName: "Jane Tan", dataUrl: PNG }));
    expect(putObjectMock).toHaveBeenCalledTimes(1);
    const arg = prismaMock.submissionDocument.create.mock.calls[0][0];
    expect(arg.data.kind).toBe("Signed");
    expect(arg.data.fileName).toContain("Signed-");
  });

  it("forbids a non-owner, non-admin", async () => {
    authMock.mockResolvedValue({ user: { associateId: "other", id: "u1", role: "SalesAssociate" } });
    const r = await signQuotationOnSystem("s1", PNG, "Jane");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
  });

  it("refuses when the quotation is not approved", async () => {
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ ...approved, status: "Submitted" });
    const r = await signQuotationOnSystem("s1", PNG, "Jane");
    expect(r.error).toBe("quotationNotApproved");
  });

  it("refuses once the sale is already closed", async () => {
    prismaMock.salesSubmission.findUnique.mockResolvedValue({ ...approved, transaction: { id: "tx1" } });
    const r = await signQuotationOnSystem("s1", PNG, "Jane");
    expect(r.error).toBe("alreadyProcessed");
  });

  it("rejects a non-PNG signature payload", async () => {
    const r = await signQuotationOnSystem("s1", "data:text/plain;base64,aGk=", "Jane");
    expect(r.error).toBe("signatureInvalid");
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("requires a signer name", async () => {
    const r = await signQuotationOnSystem("s1", PNG, "   ");
    expect(r.error).toBe("allFieldsRequired");
  });
});
