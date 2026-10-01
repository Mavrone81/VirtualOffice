import { createHash } from "crypto";
import { createWriteStream } from "fs";
import { newTempFilePath, cleanupTempFile } from "./storage";
import { sniffFileType } from "./file-type";

export type StreamUploadKind = "pdf" | "png" | "jpeg";

export type StreamUploadResult =
  | { ok: true; tempPath: string; sha256: string; sizeBytes: number; kind: StreamUploadKind }
  | { ok: false; error: "fileRequired" | "fileTooLarge" | "invalidFileType" | "uploadFailed" };

// ADR-0002: read the request body as a stream and write straight to a temp
// file (lib/storage.ts's newTempFilePath — outside the backup folder), never
// buffering the whole upload in memory. Enforces the byte cap WHILE reading
// (aborts the moment the running total crosses it, not after the fact),
// sniffs the type from the first bytes that arrive (SEC-11 — never trusts the
// client-declared Content-Type), and computes the SHA-256 in the same pass.
// The temp file is always cleaned up on any failure path, and a write-side
// failure (a full disk, an unwritable directory) always resolves promptly as
// "uploadFailed" rather than hanging or surfacing as an unhandled error.
export async function streamUploadToTemp(
  body: ReadableStream<Uint8Array> | null,
  opts: { maxBytes: number; allow: StreamUploadKind[] },
): Promise<StreamUploadResult> {
  if (!body) return { ok: false, error: "fileRequired" };

  const tempPath = await newTempFilePath();
  const hash = createHash("sha256");
  const writeStream = createWriteStream(tempPath);

  // The write side can fail asynchronously at any point (disk full, EACCES)
  // with no relation to what the read loop is doing — without this listener
  // Node treats it as an unhandled error. Recorded here and checked after
  // every operation that could be affected by it.
  let writeError: Error | undefined;
  const writeErrorPromise = new Promise<void>((resolve) => {
    writeStream.on("error", (err) => {
      writeError = err;
      resolve();
    });
  });

  let total = 0;
  let sniffed: StreamUploadKind | null = null;
  let sniffBuffer = new Uint8Array(0);

  async function destroyAndCleanup() {
    await new Promise<void>((resolve) => {
      if (writeStream.destroyed) return resolve();
      writeStream.once("close", resolve);
      writeStream.destroy();
    });
    await cleanupTempFile(tempPath);
  }

  const reader = body.getReader();
  try {
    while (true) {
      const raced = await Promise.race([
        reader.read(),
        writeErrorPromise.then(() => ({ done: true as const, value: undefined })),
      ]);
      if (writeError) break;
      const { done, value } = raced;
      if (done) break;
      if (!value || value.length === 0) continue;

      total += value.length;
      if (total > opts.maxBytes) {
        await reader.cancel().catch(() => {});
        await destroyAndCleanup();
        return { ok: false, error: "fileTooLarge" };
      }

      if (sniffed === null) {
        if (sniffBuffer.length < 4) {
          const merged = new Uint8Array(sniffBuffer.length + value.length);
          merged.set(sniffBuffer, 0);
          merged.set(value, sniffBuffer.length);
          sniffBuffer = merged;
        }
        if (sniffBuffer.length >= 4) {
          const kind = sniffFileType(sniffBuffer);
          if (!kind || !opts.allow.includes(kind)) {
            await reader.cancel().catch(() => {});
            await destroyAndCleanup();
            return { ok: false, error: "invalidFileType" };
          }
          sniffed = kind;
        }
      }

      hash.update(value);
      if (!writeStream.write(value)) {
        await Promise.race([new Promise<void>((resolve) => writeStream.once("drain", resolve)), writeErrorPromise]);
      }
      if (writeError) break;
    }
  } catch {
    await reader.cancel().catch(() => {});
    await destroyAndCleanup();
    return { ok: false, error: "uploadFailed" };
  }

  if (writeError) {
    await reader.cancel().catch(() => {});
    await destroyAndCleanup();
    return { ok: false, error: "uploadFailed" };
  }

  const endResult = await new Promise<"ok" | "error">((resolve) => {
    writeStream.end((err?: Error | null) => resolve(err ? "error" : "ok"));
  });
  if (endResult === "error" || writeError) {
    await cleanupTempFile(tempPath);
    return { ok: false, error: "uploadFailed" };
  }

  if (total === 0) {
    await cleanupTempFile(tempPath);
    return { ok: false, error: "fileRequired" };
  }
  // Fewer than 4 bytes ever arrived — too short to be a real PDF/PNG/JPEG.
  if (sniffed === null) {
    await cleanupTempFile(tempPath);
    return { ok: false, error: "invalidFileType" };
  }

  return { ok: true, tempPath, sha256: hash.digest("hex"), sizeBytes: total, kind: sniffed };
}
