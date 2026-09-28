// A-17 §Q6 UI wiring: getRequiredDocumentGate — associate-or-admin read of
// the sale's products' CURRENT required-document keys and which are already
// attached, via the same resolveProductDocGate source as
// addSubmissionRequiredDocument/verifySale/getVerifyChecklist.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    salesSubmission: { findUnique: vi.fn() },
    product: { findMany: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getRequiredDocumentGate } from "@/server/sales/actions";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.product.findMany.mockResolvedValue([
    {
      productCode: "DOC",
      requiredDocuments: [
        { key: "contract", label_en: "Contract", label_zh: "合同" },
        { key: "id_proof", label_en: "ID Proof", label_zh: "身份证明" },
      ],
      requiresAshesAgreement: false,
    },
  ]);
  prismaMock.salesSubmission.findUnique.mockResolvedValue({
    closingAssociateId: "closer1",
    lineItems: [{ productCode: "DOC" }],
    documents: [{ requirementKey: "contract" }, { requirementKey: null }],
  });
});

describe("getRequiredDocumentGate", () => {
  it("splits the sale's CURRENT required keys into attached and still-missing, for the closing associate", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const r = await getRequiredDocumentGate("sub1");
    expect(r).toEqual({
      ok: true,
      requiredDocs: [
        { key: "contract", label_en: "Contract", label_zh: "合同" },
        { key: "id_proof", label_en: "ID Proof", label_zh: "身份证明" },
      ],
      attachedKeys: ["contract"],
      productRecordMissing: false,
    });
  });

  it("allows an admin regardless of associateId", async () => {
    authMock.mockResolvedValue({ user: { role: "Admin", id: "admin1", associateId: null } });
    const r = await getRequiredDocumentGate("sub1");
    expect(r.ok).toBe(true);
  });

  it("refuses a different associate", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "other1", associateId: "other1" } });
    const r = await getRequiredDocumentGate("sub1");
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses signed-out callers", async () => {
    authMock.mockResolvedValue(null);
    const r = await getRequiredDocumentGate("sub1");
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses a missing submission", async () => {
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    prismaMock.salesSubmission.findUnique.mockResolvedValue(null);
    const r = await getRequiredDocumentGate("nope");
    expect(r).toEqual({ ok: false, error: "notFound" });
  });

  it("signals productRecordMissing (rather than erroring OR silently reporting 'nothing required') when a product can no longer be found — same condition verifySale/getVerifyChecklist hard-refuse as G3 productRecordMissing", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const r = await getRequiredDocumentGate("sub1");
    expect(r).toEqual({ ok: true, requiredDocs: [], attachedKeys: [], productRecordMissing: true });
  });

  it("de-dupes a key re-uploaded more than once (append-only rows)", async () => {
    prismaMock.salesSubmission.findUnique.mockResolvedValue({
      closingAssociateId: "closer1",
      lineItems: [{ productCode: "DOC" }],
      documents: [{ requirementKey: "contract" }, { requirementKey: "contract" }],
    });
    authMock.mockResolvedValue({ user: { role: "Associate", id: "closer1", associateId: "closer1" } });
    const r = await getRequiredDocumentGate("sub1");
    expect(r).toEqual({
      ok: true,
      requiredDocs: [
        { key: "contract", label_en: "Contract", label_zh: "合同" },
        { key: "id_proof", label_en: "ID Proof", label_zh: "身份证明" },
      ],
      attachedKeys: ["contract"],
      productRecordMissing: false,
    });
  });
});
