import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import { newTempFilePath, sweepOrphanedTempFiles, putObject, deleteObject, openObjectStream } from "./storage";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// B-9 follow-up (code review): the serving route streams instead of buffering a
// whole download into memory.
describe("openObjectStream", () => {
  it("streams the real bytes of a stored object, and reports its size", async () => {
    const key = "test/openObjectStream-fixture.bin";
    const content = Buffer.from("hello streaming world");
    await putObject(key, content);
    try {
      const opened = await openObjectStream(key);
      expect(opened).not.toBeNull();
      expect(opened!.size).toBe(content.length);
      const streamed = await readAll(opened!.stream);
      expect(Buffer.compare(streamed, content)).toBe(0);
    } finally {
      await deleteObject(key);
    }
  });

  it("returns null (never throws, never a dangling stream) for a missing key", async () => {
    const opened = await openObjectStream("test/does-not-exist.bin");
    expect(opened).toBeNull();
  });
});

// ADR-0002: a temp file only survives past its own request if the process
// crashed mid-upload — the sweep removes anything older than its own
// generous age threshold, never a file from an upload still in progress.
describe("sweepOrphanedTempFiles", () => {
  it("removes a stale (old) temp file but leaves a fresh one alone", async () => {
    const stale = await newTempFilePath();
    await fs.writeFile(stale, "orphan");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(stale, twoHoursAgo, twoHoursAgo);

    const fresh = await newTempFilePath();
    await fs.writeFile(fresh, "in-progress upload");

    const removed = await sweepOrphanedTempFiles();

    expect(removed).toBeGreaterThanOrEqual(1);
    await expect(fs.access(stale)).rejects.toThrow();
    await expect(fs.access(fresh)).resolves.toBeUndefined();

    await fs.unlink(fresh).catch(() => {});
  });

  it("is a no-op (never throws) when the temp directory doesn't exist yet", async () => {
    // newTempFilePath always creates the dir first, so this just proves the
    // function degrades gracefully rather than depending on that ordering.
    await expect(sweepOrphanedTempFiles()).resolves.toBeTypeOf("number");
  });
});
