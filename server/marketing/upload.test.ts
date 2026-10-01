import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, commitTempFileMock, deleteObjectMock, logAuditMock, envState, usageState, sweepMock } = vi.hoisted(() => ({
  prismaMock: {
    marketingCollection: { findUnique: vi.fn() },
    marketingAsset: { create: vi.fn(), findFirst: vi.fn() },
  },
  // A no-op "commit" would leave the REAL temp file streamUploadToTemp wrote
  // (see below — that part of the pipeline isn't mocked) sitting under
  // .uploads/.tmp forever, since nothing ever renames it away. Actually
  // delete it, standing in for "moved to its final key".
  commitTempFileMock: vi.fn(async (tempPath: string) => {
    const { cleanupTempFile } = await import("@/lib/storage");
    await cleanupTempFile(tempPath);
  }),
  deleteObjectMock: vi.fn(async (key: string) => { void key; }),
  logAuditMock: vi.fn(),
  envState: { MARKETING_LIBRARY_SOFT_CAP_MB: 2048 },
  usageState: { bytes: 0 },
  sweepMock: vi.fn(async () => 0),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
// Spread the REAL env (lib/storage.ts, imported via importOriginal below,
// still needs a real STORAGE_DIR) and override only the one field this
// test controls, live, so different tests can set different caps.
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { env: { ...actual.env, get MARKETING_LIBRARY_SOFT_CAP_MB() { return envState.MARKETING_LIBRARY_SOFT_CAP_MB; } } };
});
vi.mock("./list-assets", () => ({ getLibraryUsageBytes: vi.fn(async () => usageState.bytes) }));
// Only stub commitTempFile/deleteObject (this module's own calls) — keep the
// real newTempFilePath/cleanupTempFile/sweepOrphanedTempFiles so
// streamUploadToTemp's actual temp-file lifecycle still genuinely runs.
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, commitTempFile: commitTempFileMock, deleteObject: deleteObjectMock, sweepOrphanedTempFiles: sweepMock };
});

import { receiveMarketingUpload } from "./upload";

// Real magic bytes so streamUploadToTemp's real sniffing genuinely exercises
// SEC-11 — only the DB/storage side effects are mocked.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, ...new Array(20).fill(0x41)]);
function pdfBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(PDF_BYTES);
      controller.close();
    },
  });
}
function badBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0, 1, 2, 3]));
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.marketingCollection.findUnique.mockResolvedValue({ id: "col1", archivedAt: null });
  prismaMock.marketingAsset.create.mockResolvedValue({ id: "asset1" });
  envState.MARKETING_LIBRARY_SOFT_CAP_MB = 2048;
  usageState.bytes = 0;
});

describe("receiveMarketingUpload", () => {
  it("404s a missing collection", async () => {
    prismaMock.marketingCollection.findUnique.mockResolvedValue(null);
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "nope", fileName: "x.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(r).toEqual({ ok: false, status: 404, error: "notFound" });
    expect(commitTempFileMock).not.toHaveBeenCalled();
  });

  it("404s an archived collection (associates shouldn't be uploading into a retired collection either)", async () => {
    prismaMock.marketingCollection.findUnique.mockResolvedValue({ id: "col1", archivedAt: new Date() });
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "x.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(r).toEqual({ ok: false, status: 404, error: "notFound" });
  });

  it("rejects content whose magic bytes don't match PDF/PNG/JPEG, with a 400", async () => {
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "x.pdf", body: badBody(), contentLength: 4 });
    expect(r).toEqual({ ok: false, status: 400, error: "invalidFileType" });
    expect(prismaMock.marketingAsset.create).not.toHaveBeenCalled();
  });

  it("413s a declared Content-Length over the 20MB cap, before ever touching the body", async () => {
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "x.pdf", body: pdfBody(), contentLength: 20_000_001 });
    expect(r).toEqual({ ok: false, status: 413, error: "fileTooLarge" });
    expect(commitTempFileMock).not.toHaveBeenCalled();
  });

  it("sweeps orphaned temp files at the start of every upload (in-app, on upload start, not a host cron)", async () => {
    await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "flyer.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it("a sweep failure never blocks the upload itself (best-effort)", async () => {
    sweepMock.mockRejectedValueOnce(new Error("disk hiccup"));
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "flyer.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(r).toEqual({ ok: true, id: "asset1", duplicate: false, warnNearCap: false });
  });

  it("commits the file, creates the asset with the sniffed mime/size/sha256, and audits it", async () => {
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "flyer.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(r).toEqual({ ok: true, id: "asset1", duplicate: false, warnNearCap: false });
    expect(commitTempFileMock).toHaveBeenCalledTimes(1);
    const created = prismaMock.marketingAsset.create.mock.calls[0][0].data;
    expect(created.collectionId).toBe("col1");
    expect(created.fileName).toBe("flyer.pdf");
    expect(created.mimeType).toBe("application/pdf");
    expect(created.sizeBytes).toBe(PDF_BYTES.length);
    expect(created.uploadedById).toBe("admin1");
    expect(created.fileKey).toMatch(/^marketing\/.+\.pdf$/);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "marketing.asset_uploaded", entityId: "asset1" }));
  });

  it("U2: on a unique-constraint violation (P2002), deletes the just-written file and returns the EXISTING row as a duplicate", async () => {
    const { Prisma } = await import("@prisma/client");
    prismaMock.marketingAsset.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6" }),
    );
    prismaMock.marketingAsset.findFirst.mockResolvedValue({ id: "winner-asset" });

    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "flyer.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });

    expect(r).toEqual({ ok: true, id: "winner-asset", duplicate: true, warnNearCap: false });
    expect(deleteObjectMock).toHaveBeenCalledTimes(1);
    const deletedKey = deleteObjectMock.mock.calls[0][0] as string;
    expect(deletedKey).toMatch(/^marketing\//);
  });
});

describe("ADR-0002 decision 4: the library soft cap (build now, default 2048 MB)", () => {
  it("79% usage: succeeds with no warning", async () => {
    envState.MARKETING_LIBRARY_SOFT_CAP_MB = 1; // 1,000,000-byte cap for a small, exact test
    usageState.bytes = 780_000; // + PDF_BYTES.length (28) stays just under 80%
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "x.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(r).toEqual({ ok: true, id: "asset1", duplicate: false, warnNearCap: false });
  });

  it("80% usage: succeeds, but with warnNearCap true", async () => {
    envState.MARKETING_LIBRARY_SOFT_CAP_MB = 1;
    usageState.bytes = 799_980; // + 28 lands at 800,008 (80.0008%)
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "x.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(r).toEqual({ ok: true, id: "asset1", duplicate: false, warnNearCap: true });
  });

  it("100% usage (declared Content-Length pushes over): refused before streaming, no file written", async () => {
    envState.MARKETING_LIBRARY_SOFT_CAP_MB = 1;
    usageState.bytes = 999_980; // + PDF_BYTES.length (28) crosses 1,000,000
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "x.pdf", body: pdfBody(), contentLength: PDF_BYTES.length });
    expect(r).toEqual({ ok: false, status: 413, error: "libraryFull" });
    expect(commitTempFileMock).not.toHaveBeenCalled();
  });

  it("100% usage, discovered only after streaming (Content-Length understated it): refused, temp file cleaned up, no row created", async () => {
    envState.MARKETING_LIBRARY_SOFT_CAP_MB = 1;
    usageState.bytes = 999_980;
    // Declares a smaller length than the real body, so the pre-stream check
    // passes but the post-stream actual-size check must still catch it.
    const r = await receiveMarketingUpload({ actorUserId: "admin1", collectionId: "col1", fileName: "x.pdf", body: pdfBody(), contentLength: 1 });
    expect(r).toEqual({ ok: false, status: 413, error: "libraryFull" });
    expect(prismaMock.marketingAsset.create).not.toHaveBeenCalled();
  });
});
