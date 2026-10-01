import { describe, it, expect, vi } from "vitest";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { env } from "./env";
import { streamUploadToTemp } from "./streaming-upload";
import * as storage from "./storage";
const { cleanupTempFile } = storage;

const TMP_DIR = path.resolve(env.STORAGE_DIR, ".tmp");
async function listTmp(): Promise<string[]> {
  try {
    return await fs.readdir(TMP_DIR);
  } catch {
    return [];
  }
}

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"

describe("streamUploadToTemp (ADR-0002)", () => {
  it("rejects a null body", async () => {
    const r = await streamUploadToTemp(null, { maxBytes: 1000, allow: ["pdf"] });
    expect(r).toEqual({ ok: false, error: "fileRequired" });
  });

  it("accepts a valid streamed PDF split across multiple chunks, computing the correct sha256 and size", async () => {
    const tail = new Uint8Array(5000).fill(0x41); // padding so it spans several chunks
    const full = new Uint8Array(PDF_HEADER.length + tail.length);
    full.set(PDF_HEADER, 0);
    full.set(tail, PDF_HEADER.length);
    const chunkSize = 1000;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < full.length; i += chunkSize) chunks.push(full.slice(i, i + chunkSize));

    const r = await streamUploadToTemp(streamFromChunks(chunks), { maxBytes: 1_000_000, allow: ["pdf", "png", "jpeg"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("pdf");
    expect(r.sizeBytes).toBe(full.length);
    expect(r.sha256).toBe(createHash("sha256").update(full).digest("hex"));

    const onDisk = await fs.readFile(r.tempPath);
    expect(Buffer.compare(onDisk, Buffer.from(full))).toBe(0);
    await cleanupTempFile(r.tempPath);
  });

  it("rejects content whose magic bytes don't match an allowed type, regardless of size", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const before = await listTmp();
    const r = await streamUploadToTemp(streamFromChunks([bytes]), { maxBytes: 1000, allow: ["pdf"] });
    expect(r).toEqual({ ok: false, error: "invalidFileType" });
    expect(await listTmp()).toEqual(before); // temp file cleaned up, nothing left behind
  });

  it("aborts WHILE STREAMING the moment the running total crosses the cap — never buffers the whole body first", async () => {
    const before = await listTmp();
    // 5 chunks of 1000 bytes each (5000 total) against a 2500-byte cap: must
    // abort partway through, not after reading everything.
    const chunks = Array.from({ length: 5 }, (_, i) => {
      const c = new Uint8Array(1000);
      if (i === 0) c.set(PDF_HEADER, 0);
      return c;
    });
    const r = await streamUploadToTemp(streamFromChunks(chunks), { maxBytes: 2500, allow: ["pdf"] });
    expect(r).toEqual({ ok: false, error: "fileTooLarge" });
    expect(await listTmp()).toEqual(before);
  });

  it("rejects an empty body", async () => {
    const r = await streamUploadToTemp(streamFromChunks([]), { maxBytes: 1000, allow: ["pdf"] });
    expect(r).toEqual({ ok: false, error: "fileRequired" });
  });

  it("security review B1: a write-side failure (unwritable temp dir) resolves promptly as uploadFailed — no hang, no unhandled error, no file left behind", async () => {
    if (process.getuid && process.getuid() === 0) return; // root ignores permission bits
    const badDir = path.resolve(env.STORAGE_DIR, ".tmp-readonly-test");
    await fs.mkdir(badDir, { recursive: true });
    await fs.chmod(badDir, 0o555); // no write permission — createWriteStream can't create a file inside it
    const badPath = path.join(badDir, "wontopen.part");
    const spy = vi.spyOn(storage, "newTempFilePath").mockResolvedValueOnce(badPath);

    try {
      const r = await streamUploadToTemp(streamFromChunks([PDF_HEADER]), { maxBytes: 1000, allow: ["pdf"] });
      expect(r).toEqual({ ok: false, error: "uploadFailed" });
      expect(await fs.readdir(badDir)).toEqual([]);
    } finally {
      spy.mockRestore();
      await fs.chmod(badDir, 0o755);
      await fs.rm(badDir, { recursive: true, force: true });
    }
  });
});
