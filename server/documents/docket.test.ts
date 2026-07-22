import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, addDocsMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { salesSubmission: { findUnique: vi.fn() } },
  addDocsMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/documents/submission-docs", () => ({ addSubmissionDocuments: addDocsMock }));

import { uploadDocketDocuments } from "@/app/portal/quotations/actions";

const file = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "signed.pdf");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.salesSubmission.findUnique.mockResolvedValue({ closingAssociateId: "a1" });
  addDocsMock.mockResolvedValue({ stored: 1, rejected: [] });
});

describe("uploadDocketDocuments", () => {
  it("lets the closing associate add signed docs", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate", associateId: "a1" } });
    const r = await uploadDocketDocuments("sub1", [file()]);
    expect(r.ok).toBe(true);
    expect(addDocsMock).toHaveBeenCalledWith("sub1", expect.any(Array), "Signed", "u1");
  });

  it("rejects a non-owner, non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u2", role: "SalesAssociate", associateId: "other" } });
    const r = await uploadDocketDocuments("sub1", [file()]);
    expect(r.ok).toBe(false);
    expect(addDocsMock).not.toHaveBeenCalled();
  });

  it("lets an admin add signed docs to any sale", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin", associateId: null } });
    const r = await uploadDocketDocuments("sub1", [file()]);
    expect(r.ok).toBe(true);
  });

  it("reports when every file was rejected", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssociate", associateId: "a1" } });
    addDocsMock.mockResolvedValue({ stored: 0, rejected: ["signed.pdf"] });
    const r = await uploadDocketDocuments("sub1", [file()]);
    expect(r.ok).toBe(false);
  });
});
