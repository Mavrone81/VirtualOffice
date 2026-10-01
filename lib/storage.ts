import { promises as fs } from "fs";
import { createReadStream } from "fs";
import { Readable } from "stream";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "./env";

// Local-filesystem object store. Keys are POSIX-style relative paths
// (e.g. "candidates/<id>/photo.jpg"). A single storage abstraction so a future
// S3/R2 backend can be swapped in without touching call sites.
const ROOT = path.resolve(env.STORAGE_DIR);
// B-9 / ADR-0002 N5: uploads-in-progress live here, never directly under a
// final key — so a half-written file is never served, and deploy/vo-backup.sh
// excludes this directory by name (`--exclude=./.tmp`) so a backup never
// captures one either.
const TMP_DIR = path.join(ROOT, ".tmp");

function resolveKey(key: string): string {
  const clean = path.posix
    .normalize(key)
    .replace(/^(\.\.(\/|$))+/, "")
    .replace(/^\/+/, "");
  const abs = path.resolve(ROOT, clean);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    throw new Error("Invalid storage key (path traversal)");
  }
  return abs;
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  const abs = resolveKey(key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data);
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(resolveKey(key));
  } catch {
    return null;
  }
}

// B-9 follow-up (code review): the serving route was buffering up to 20 MB per
// download into memory via getObject. This streams instead — fs.stat first
// (so a missing file is a clean null, not a mid-stream error) then a real
// read stream, so a large file's bytes pass through without ever sitting in
// memory all at once.
export async function openObjectStream(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  const abs = resolveKey(key);
  try {
    const stat = await fs.stat(abs);
    const nodeStream = createReadStream(abs);
    return { stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>, size: stat.size };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await fs.unlink(resolveKey(key));
  } catch {
    /* already gone */
  }
}

// --- Streaming-upload support (B-9 / ADR-0002) ------------------------------
// A large streamed upload is written to a temp path first (never directly to
// its final key), so a request that fails partway never leaves a partial or
// half-hashed file under a real key.

export async function newTempFilePath(): Promise<string> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  return path.join(TMP_DIR, `${randomUUID()}.part`);
}

export async function cleanupTempFile(tempPath: string): Promise<void> {
  try {
    await fs.unlink(tempPath);
  } catch {
    /* already gone */
  }
}

// Moves a fully-written, already-validated temp file into its final key.
// `fs.rename` is atomic and cheap here because .tmp is a subdirectory of the
// same STORAGE_DIR root, so this never crosses filesystems.
export async function commitTempFile(tempPath: string, key: string): Promise<void> {
  const abs = resolveKey(key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.rename(tempPath, abs);
}

// Startup sweep (ADR-0002): a temp file only survives past its own request if
// the process crashed mid-upload. Anything older than this is orphaned, never
// a live upload in progress — a 20 MB upload on a slow admin connection is
// still seconds, not hours.
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;

export async function sweepOrphanedTempFiles(): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(TMP_DIR);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - TEMP_FILE_MAX_AGE_MS;
  for (const name of entries) {
    const abs = path.join(TMP_DIR, name);
    try {
      const stat = await fs.stat(abs);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(abs);
        removed++;
      }
    } catch {
      /* raced with something else cleaning it up — fine */
    }
  }
  return removed;
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".vcf": "text/vcard",
};

export function contentTypeForKey(key: string): string {
  return MIME[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

const EXT_FOR_IMAGE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function imageExt(mime: string): string | null {
  return EXT_FOR_IMAGE[mime] ?? null;
}

// Types a browser may render in place. Everything else is forced to download.
const INLINE_SAFE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

/**
 * Response headers for serving a stored object (SEC-11). Never let the browser
 * sniff a different type than the one we declare (the app sets this itself
 * rather than relying on the proxy), and only render images/PDF inline.
 */
export function objectResponseHeaders(key: string, opts: { filename?: string; cacheControl: string }): Record<string, string> {
  const type = contentTypeForKey(key);
  const disposition = INLINE_SAFE.has(type) ? "inline" : "attachment";
  const name = (opts.filename ?? key.split("/").pop() ?? "file").replace(/[^\w.\-]/g, "_");
  return {
    "Content-Type": type,
    "Content-Disposition": `${disposition}; filename="${name}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": opts.cacheControl,
  };
}
