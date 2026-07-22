import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, putObjectMock, assertMock } = vi.hoisted(() => ({
  prismaMock: { submissionDocument: { create: vi.fn() } },
  putObjectMock: vi.fn(),
  assertMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage", () => ({ putObject: putObjectMock }));
vi.mock("@/lib/file-type", () => ({ assertUpload: assertMock }));

import { addSubmissionDocuments, MAX_DOC_BYTES } from "@/server/documents/submission-docs";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.submissionDocument.create.mockResolvedValue({});
  putObjectMock.mockResolvedValue(undefined);
  assertMock.mockReturnValue("pdf");
});

describe("addSubmissionDocuments", () => {
  it("stores each valid file and creates a row tagged with the kind", async () => {
    const f = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf");
    const r = await addSubmissionDocuments("sub1", [f], "Supporting", "user1");
    expect(r).toEqual({ stored: 1, rejected: [] });
    expect(putObjectMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.submissionDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submissionId: "sub1", kind: "Supporting", fileName: "a.pdf", uploadedById: "user1" }) }),
    );
  });

  it("skips an oversize file without storing, and reports it", async () => {
    const big = new File([new Uint8Array(MAX_DOC_BYTES + 1)], "big.pdf");
    const r = await addSubmissionDocuments("sub1", [big], "Supporting", null);
    expect(r.stored).toBe(0);
    expect(r.rejected).toContain("big.pdf");
    expect(putObjectMock).not.toHaveBeenCalled();
    expect(prismaMock.submissionDocument.create).not.toHaveBeenCalled();
  });

  it("skips a file that fails magic-byte sniffing", async () => {
    assertMock.mockImplementation(() => { throw new Error("BAD_UPLOAD_TYPE"); });
    const f = new File([new Uint8Array([0x00, 0x01])], "fake.exe");
    const r = await addSubmissionDocuments("sub1", [f], "Supporting", null);
    expect(r).toEqual({ stored: 0, rejected: ["fake.exe"] });
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("ignores empty file slots", async () => {
    const empty = new File([], "");
    const r = await addSubmissionDocuments("sub1", [empty], "Supporting", null);
    expect(r).toEqual({ stored: 0, rejected: [] });
  });
});
