import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, logAuditMock, envState } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    product: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
    // add/remove read the list via SELECT ... FOR UPDATE inside the tx; the
    // tests keep stubbing product.findUnique, and this maps it to the row shape.
    $queryRaw: vi.fn(async (): Promise<unknown[]> => {
      const p = (await prismaMock.product.findUnique()) as { requiredDocuments: unknown } | null;
      return p ? [{ required_documents: p.requiredDocuments }] : [];
    }),
  },
  logAuditMock: vi.fn(),
  envState: { A17_CLOSED_DEAL_FLOW: true },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  auditTx: logAuditMock,
  AuditWriteError: class AuditWriteError extends Error {},
}));
vi.mock("@/lib/env", () => ({ get env() { return envState; } }));

import { addProductRequiredDocument, removeProductRequiredDocument, setProductAshesAgreementFlag } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  envState.A17_CLOSED_DEAL_FLOW = true;
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
});

describe("build-now-ship-later: A17_CLOSED_DEAL_FLOW gates all three actions", () => {
  it("refuses all three with notFound when the flag is off, before even checking admin", async () => {
    envState.A17_CLOSED_DEAL_FLOW = false;
    authMock.mockResolvedValue(null); // would also fail admin — flag check must win first

    expect(await addProductRequiredDocument("p1", { labelEn: "Contract", labelZh: "合同" })).toEqual({ ok: false, error: "notFound" });
    expect(await removeProductRequiredDocument("p1", "contract")).toEqual({ ok: false, error: "notFound" });
    expect(await setProductAshesAgreementFlag("p1", true)).toEqual({ ok: false, error: "notFound" });
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });
});

describe("addProductRequiredDocument", () => {
  it("refuses a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await addProductRequiredDocument("p1", { labelEn: "Contract", labelZh: "合同" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });

  it("rejects an empty label", async () => {
    const r = await addProductRequiredDocument("p1", { labelEn: "  ", labelZh: "合同" });
    expect(r).toEqual({ ok: false, error: "invalidInput" });
  });

  it("404s a missing product", async () => {
    prismaMock.product.findUnique.mockResolvedValue(null);
    const r = await addProductRequiredDocument("nope", { labelEn: "Contract", labelZh: "合同" });
    expect(r).toEqual({ ok: false, error: "notFound" });
  });

  it("generates the key from the English label (never admin-typed), stores snake_case, and audits it", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ requiredDocuments: [] });
    const r = await addProductRequiredDocument("p1", { labelEn: "Signed Contract", labelZh: "签署合同" });
    expect(r).toEqual({ ok: true, key: "signed_contract" });
    const updated = prismaMock.product.update.mock.calls[0][0].data.requiredDocuments;
    expect(updated).toEqual([{ key: "signed_contract", label_en: "Signed Contract", label_zh: "签署合同" }]);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "product.required_document_added", entityId: "p1" }),
    );
  });

  it("dedupes the key against the product's OWN existing entries", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ requiredDocuments: [{ key: "signed_contract", label_en: "Signed Contract", label_zh: "签署合同" }] });
    const r = await addProductRequiredDocument("p1", { labelEn: "Signed Contract", labelZh: "另一份合同" });
    expect(r).toEqual({ ok: true, key: "signed_contract_2" });
  });

  it("refuses at the bound (20 requirements per product)", async () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, label_en: `L${i}`, label_zh: `L${i}` }));
    prismaMock.product.findUnique.mockResolvedValue({ requiredDocuments: existing });
    const r = await addProductRequiredDocument("p1", { labelEn: "One Too Many", labelZh: "太多了" });
    expect(r).toEqual({ ok: false, error: "requiredDocumentsLimitReached" });
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });
});

describe("removeProductRequiredDocument", () => {
  it("refuses a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await removeProductRequiredDocument("p1", "signed_contract");
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("404s an unknown key", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ requiredDocuments: [] });
    const r = await removeProductRequiredDocument("p1", "nope");
    expect(r).toEqual({ ok: false, error: "notFound" });
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });

  it("removes only the matching entry, leaving the rest untouched, and audits the before-snapshot", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      requiredDocuments: [
        { key: "signed_contract", label_en: "Signed Contract", label_zh: "签署合同" },
        { key: "payment_proof", label_en: "Payment Proof", label_zh: "付款证明" },
      ],
    });
    const r = await removeProductRequiredDocument("p1", "signed_contract");
    expect(r).toEqual({ ok: true });
    const updated = prismaMock.product.update.mock.calls[0][0].data.requiredDocuments;
    expect(updated).toEqual([{ key: "payment_proof", label_en: "Payment Proof", label_zh: "付款证明" }]);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "product.required_document_removed", before: { key: "signed_contract", label_en: "Signed Contract", label_zh: "签署合同" } }),
    );
  });
});

describe("setProductAshesAgreementFlag", () => {
  it("refuses a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate" } });
    const r = await setProductAshesAgreementFlag("p1", true);
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("404s a missing product", async () => {
    prismaMock.product.findUnique.mockResolvedValue(null);
    const r = await setProductAshesAgreementFlag("nope", true);
    expect(r).toEqual({ ok: false, error: "notFound" });
  });

  it("toggles the flag on and off, auditing each direction", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: "p1" });

    await setProductAshesAgreementFlag("p1", true);
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { requiresAshesAgreement: true } });
    expect(logAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "product.ashes_agreement_required" }));

    await setProductAshesAgreementFlag("p1", false);
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { requiresAshesAgreement: false } });
    expect(logAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "product.ashes_agreement_not_required" }));
  });
});
