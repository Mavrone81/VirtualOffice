import { describe, it, expect, vi } from "vitest";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { env } from "./env";
import { streamUploadToTemp } from "./streaming-upload";
import * as storage from "./storage";
const { cleanupTempFile } = storage;

const TMP_DIR = path.resolve(env.STORAGE_DIR, ".tmp");

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

/**
 * Runs `streamUploadToTemp` and returns the exact .part path IT created,
 * captured via a call-through spy on the real `newTempFilePath` (same
 * mechanism the "write-side failure" test below already uses to mock it) —
 * never a directory census. DevLead/AD, 2026-10-02: the old pattern
 * (`listTmp()` before/after, `toEqual`) compares the WHOLE shared `.tmp`
 * directory, so a neighbour test's in-flight `.part` file (this dir is
 * shared by every file in the unit project, which is NOT
 * `fileParallelism: false`) can be present at the "after" read and fail an
 * assertion that has nothing to do with it. Checking only the path this
 * call itself created is immune to that by construction — it can't see a
 * neighbour's file because it never looks at the directory as a whole.
 */
async function runAndGetOwnTempPath<T>(run: () => Promise<T>): Promise<{ result: T; ownPath: string }> {
  const spy = vi.spyOn(storage, "newTempFilePath");
  try {
    const result = await run();
    expect(spy).toHaveBeenCalledTimes(1);
    const ownPath = await spy.mock.results[0].value;
    return { result, ownPath };
  } finally {
    spy.mockRestore();
  }
}

async function tempFileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

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
    const { result: r, ownPath } = await runAndGetOwnTempPath(() =>
      streamUploadToTemp(streamFromChunks([bytes]), { maxBytes: 1000, allow: ["pdf"] }),
    );
    expect(r).toEqual({ ok: false, error: "invalidFileType" });
    expect(await tempFileExists(ownPath)).toBe(false); // MY temp file cleaned up — a neighbour's is none of this test's business
  });

  it("aborts WHILE STREAMING the moment the running total crosses the cap — never buffers the whole body first", async () => {
    // 5 chunks of 1000 bytes each (5000 total) against a 2500-byte cap: must
    // abort partway through, not after reading everything.
    const chunks = Array.from({ length: 5 }, (_, i) => {
      const c = new Uint8Array(1000);
      if (i === 0) c.set(PDF_HEADER, 0);
      return c;
    });
    const { result: r, ownPath } = await runAndGetOwnTempPath(() =>
      streamUploadToTemp(streamFromChunks(chunks), { maxBytes: 2500, allow: ["pdf"] }),
    );
    expect(r).toEqual({ ok: false, error: "fileTooLarge" });
    expect(await tempFileExists(ownPath)).toBe(false);
  });

  // DevLead/AD, 2026-10-02: deterministic regression guard for the race
  // above — forces the exact interleaving (a neighbour's in-flight .part
  // file present in the shared TMP_DIR at check time) rather than hoping a
  // real neighbour test happens to be scheduled at the wrong moment. Fails
  // every time against the OLD `listTmp()` census pattern (confirmed by
  // hand before this fix: reverting the two assertions above to the old
  // form and running this exact scenario fails deterministically, not
  // occasionally); passes against the own-path check because that check
  // never reads the directory as a whole.
  it("a neighbour's in-flight temp file in the SAME shared directory does not affect this test (synthetic, deterministic)", async () => {
    await fs.mkdir(TMP_DIR, { recursive: true });
    const neighbourPath = path.join(TMP_DIR, "synthetic-neighbour-upload.part");
    try {
      const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
      // The neighbour's file appears AFTER this test's own "before" state
      // and is STILL there at "after" time — exactly the window the real
      // failure happened in (a neighbour test starts between this test's
      // snapshot and its final check, and hasn't cleaned up yet).
      await fs.writeFile(neighbourPath, "pretend another test's in-flight upload");
      const { result: r, ownPath } = await runAndGetOwnTempPath(() =>
        streamUploadToTemp(streamFromChunks([bytes]), { maxBytes: 1000, allow: ["pdf"] }),
      );
      expect(r).toEqual({ ok: false, error: "invalidFileType" });
      expect(await tempFileExists(ownPath)).toBe(false); // own file still correctly cleaned up
      expect(await tempFileExists(neighbourPath)).toBe(true); // the neighbour's file is untouched — and irrelevant
    } finally {
      await fs.rm(neighbourPath, { force: true });
    }
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
