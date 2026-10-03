import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// Unit-level, same mocking as template-actions.test.ts: real
// uploadLibraryDocument + real uploadDocTemplate, prisma/storage/auth mocked.
// uploadDocTemplate is wrapped in a spy that still runs the real function, so
// "the shared versioning path was called" is observed, not assumed.

const { prismaMock, putObjectMock, state, templateSpy, documentSpy } = vi.hoisted(() => ({
  prismaMock: {
    document: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(async () => ({ id: "new-doc-1" })),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
  },
  putObjectMock: vi.fn(async () => undefined),
  state: { role: "Admin" as string },
  templateSpy: vi.fn(),
  documentSpy: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage", () => ({ putObject: putObjectMock, deleteObject: vi.fn(async () => undefined) }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "admin1", role: state.role, associateId: null } }) }));
vi.mock("@/lib/audit", () => ({ auditTx: vi.fn(async () => undefined) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./template-actions", async (orig) => {
  const actual = await orig<typeof import("./template-actions")>();
  templateSpy.mockImplementation(actual.uploadDocTemplate);
  return { ...actual, uploadDocTemplate: templateSpy };
});
vi.mock("./actions", () => ({ uploadDocument: documentSpy }));

import { uploadLibraryDocument } from "./library-actions";
import { listAdminDocuments } from "@/lib/admin-documents";

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, ...new Array(20).fill(0x41)];
const file = () => new File([new Uint8Array(PDF)], "a.pdf");
const CURRENT = { id: "old-doc-1", assignment: "All", assignedTeam: null, assignedAssociateId: null, visibility: "All", fileKey: "documents/old.pdf" };

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "Admin";
  prismaMock.document.findFirst.mockResolvedValue(null);
  prismaMock.document.update.mockResolvedValue({});
  prismaMock.document.create.mockResolvedValue({ id: "new-doc-1" });
});

describe("uploadLibraryDocument — replace confirmation", () => {
  it("refuses to replace an existing category template without confirmation: nothing retired, written or created", async () => {
    prismaMock.document.findFirst.mockResolvedValue(CURRENT);
    const r = await uploadLibraryDocument({ category: "PetsAfterlife", title: "T", file: file() });
    expect(r).toEqual({ ok: false, error: "form.errorNeedsConfirm" });
    expect(templateSpy).not.toHaveBeenCalled();
    expect(prismaMock.document.update).not.toHaveBeenCalled();
    expect(prismaMock.document.create).not.toHaveBeenCalled();
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("with confirmation, retires the current row through the shared versioning path", async () => {
    prismaMock.document.findFirst.mockResolvedValue(CURRENT);
    const r = await uploadLibraryDocument({ category: "PetsAfterlife", title: "T", file: file(), confirmedReplace: true });
    expect(r).toEqual({ ok: true });
    expect(prismaMock.document.update).toHaveBeenCalledWith({
      where: { id: "old-doc-1" },
      data: { retiredAt: expect.any(Date), supersededById: expect.any(String) },
    });
  });

  it("first upload for a category needs no confirmation (nothing to retire)", async () => {
    const r = await uploadLibraryDocument({ category: "HumanAfterlife", title: "T", file: file() });
    expect(r).toEqual({ ok: true });
    expect(prismaMock.document.update).not.toHaveBeenCalled();
  });

  it("rejects a non-admin before reading or writing anything", async () => {
    state.role = "SalesAssociate";
    const r = await uploadLibraryDocument({ category: "PetsAfterlife", title: "T", file: file(), confirmedReplace: true });
    expect(r).toEqual({ ok: false, error: "form.errorForbidden" });
    expect(prismaMock.document.findFirst).not.toHaveBeenCalled();
    expect(templateSpy).not.toHaveBeenCalled();
  });
});

describe("uploadLibraryDocument — audience", () => {
  it("a category template cannot be addressed to a team: forged audience fields are dropped, row is All", async () => {
    const forged = { category: "PetsAfterlife", title: "T", file: file(), assignment: "Team", assignedTeam: "Alpha", assignedAssociateCode: "EN0001" };
    const r = await uploadLibraryDocument(forged as never);
    expect(r).toEqual({ ok: true });
    expect(templateSpy).toHaveBeenCalledWith({ category: "PetsAfterlife", title: "T", file: forged.file });
    const data = (prismaMock.document.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ category: "PetsAfterlife", assignment: "All", assignedTeam: null, assignedAssociateId: null, visibility: "All" });
    expect(documentSpy).not.toHaveBeenCalled();
  });

  it("an unknown category is rejected, not passed to the database", async () => {
    const r = await uploadLibraryDocument({ category: "Bogus", title: "T", file: file() } as never);
    expect(r.ok).toBe(false);
    expect(templateSpy).not.toHaveBeenCalled();
  });
});

describe("uploadLibraryDocument — shared versioning", () => {
  it("category null goes to the ordinary uploader with its audience, never to the template path", async () => {
    const input = { category: null, title: "T", type: "Other", assignment: "Team", assignedTeam: "Alpha", file: file() } as const;
    await uploadLibraryDocument(input as never);
    expect(documentSpy).toHaveBeenCalledWith(input);
    expect(templateSpy).not.toHaveBeenCalled();
  });

  it("category path delegates to uploadDocTemplate and contains no retire/supersede logic of its own", async () => {
    await uploadLibraryDocument({ category: "PetsAfterlife", title: "T", file: file() });
    expect(templateSpy).toHaveBeenCalledTimes(1);
    const src = readFileSync(new URL("./library-actions.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/retiredAt\s*:\s*new|supersededBy|\.update\(|\.updateMany\(|\.create\(|\.\$transaction/);
  });
});

describe("listAdminDocuments", () => {
  it("excludes retired template versions", async () => {
    await listAdminDocuments();
    const args = (prismaMock.document.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0];
    expect(args.where).toEqual({ retiredAt: null });
  });
});
