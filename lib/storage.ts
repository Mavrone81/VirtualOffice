import { promises as fs } from "fs";
import path from "path";
import { env } from "./env";

// Local-filesystem object store. Keys are POSIX-style relative paths
// (e.g. "candidates/<id>/photo.jpg"). A single storage abstraction so a future
// S3/R2 backend can be swapped in without touching call sites.
const ROOT = path.resolve(env.STORAGE_DIR);

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

export async function deleteObject(key: string): Promise<void> {
  try {
    await fs.unlink(resolveKey(key));
  } catch {
    /* already gone */
  }
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
