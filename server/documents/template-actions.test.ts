import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-level: prisma/storage/auth mocked, real lib/file-type sniffing (D2) and
// real flow control. The concurrency guarantee itself (real DB, real partial
// unique index) lives in template-actions.integration.test.ts — a mocked
// $transaction can't exercise a real unique-violation race.

const { prismaMock, putObjectMock, deleteObjectMock, auditTxMock, state } = vi.hoisted(() => ({
  prismaMock: {
    document: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(async () => ({ id: "new-doc-1" })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
  },
  putObjectMock: vi.fn(async () => undefined),
  deleteObjectMock: vi.fn(async () => undefined),
  auditTxMock: vi.fn(async () => undefined),
  state: { role: "Admin" as string },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage", () => ({ putObject: putObjectMock, deleteObject: deleteObjectMock }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: state.role, associateId: null } }) }));
vi.mock("@/lib/audit", () => ({ auditTx: auditTxMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { uploadDocTemplate } from "@/server/documents/template-actions";
import { Prisma } from "@prisma/client";

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, ...new Array(20).fill(0x41)];
const file = (bytes: number[], name: string) => new File([new Uint8Array(bytes)], name);

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "Admin";
  prismaMock.document.findFirst.mockResolvedValue(null);
  prismaMock.document.update.mockResolvedValue({});
  prismaMock.document.create.mockResolvedValue({ id: "new-doc-1" });
});

describe("uploadDocTemplate", () => {
  it("rejects a non-admin", async () => {
    state.role = "SalesAssociate";
    const r = await uploadDocTemplate({ category: "PetsAfterlife", title: "T", file: file(PDF, "x.pdf") });
    expect(r).toEqual({ ok: false, error: "form.errorForbidden" });
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("rejects an empty title", async () => {
    const r = await uploadDocTemplate({ category: "PetsAfterlife", title: "  ", file: file(PDF, "x.pdf") });
    expect(r).toEqual({ ok: false, error: "form.errorNoTitle" });
  });

  it("D2: a PDF uploaded with a .png filename is stored with a .pdf key, not .png", async () => {
    const r = await uploadDocTemplate({ category: "PetsAfterlife", title: "T", file: file(PDF, "not-a-pdf.png") });
    expect(r).toEqual({ ok: true, id: "new-doc-1" });
    const key = (putObjectMock.mock.calls[0] as unknown as [string])[0];
    expect(key).toMatch(/^documents\/[0-9a-f-]{36}\.pdf$/);
  });

  it("D2: an HTML payload (regardless of filename) is rejected by sniffing, nothing is written", async () => {
    const r = await uploadDocTemplate({ category: "PetsAfterlife", title: "T", file: file([...new TextEncoder().encode("<html></html>")], "fake.pdf") });
    expect(r).toEqual({ ok: false, error: "form.errorInvalidFileType" });
    expect(putObjectMock).not.toHaveBeenCalled();
    expect(prismaMock.document.create).not.toHaveBeenCalled();
  });

  it("first upload for a category: nothing to retire, inserts with default assignment/visibility All", async () => {
    const r = await uploadDocTemplate({ category: "HumanAfterlife", title: "First", file: file(PDF, "a.pdf") });
    expect(r).toEqual({ ok: true, id: "new-doc-1" });
    expect(prismaMock.document.update).not.toHaveBeenCalled();
    const data = (prismaMock.document.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.assignment).toBe("All");
    expect(data.visibility).toBe("All");
    expect(data.category).toBe("HumanAfterlife");
  });

  it("replace: retires the current row (retiredAt + supersededById) and copies its assignment/visibility onto the new row — never widens access", async () => {
    prismaMock.document.findFirst.mockResolvedValue({
      id: "old-doc-1", assignment: "Team", assignedTeam: "Alpha", assignedAssociateId: null, visibility: "Admin", fileKey: "documents/old-doc-1.pdf",
    });
    const r = await uploadDocTemplate({ category: "PetsAfterlife", title: "Replacement", file: file(PDF, "a.pdf") });
    expect(r).toEqual({ ok: true, id: "new-doc-1" });

    expect(prismaMock.document.update).toHaveBeenCalledWith({
      where: { id: "old-doc-1" },
      data: { retiredAt: expect.any(Date), supersededById: expect.any(String) },
    });
    const newData = (prismaMock.document.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(newData.assignment).toBe("Team");
    expect(newData.assignedTeam).toBe("Alpha");
    expect(newData.visibility).toBe("Admin");
  });

  it("M1: if the DB create fails, the just-written file is deleted (no orphan) and nothing is left half-done", async () => {
    prismaMock.document.create.mockRejectedValue(new Error("db down"));
    await expect(uploadDocTemplate({ category: "PetsAfterlife", title: "T", file: file(PDF, "a.pdf") })).rejects.toThrow("db down");
    expect(deleteObjectMock).toHaveBeenCalledTimes(1);
    const deletedKey = (deleteObjectMock.mock.calls[0] as unknown as [string])[0];
    expect(deletedKey).toMatch(/^documents\//);
  });

  it("on a P2002 unique-violation (the partial index catching a lost race), deletes the just-written file and returns a conflict error, not a throw", async () => {
    prismaMock.document.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6" }),
    );
    const r = await uploadDocTemplate({ category: "PetsAfterlife", title: "T", file: file(PDF, "a.pdf") });
    expect(r).toEqual({ ok: false, error: "form.errorConflict" });
    expect(deleteObjectMock).toHaveBeenCalledTimes(1);
  });
});
