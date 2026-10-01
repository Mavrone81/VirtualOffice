import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { env } from "@/lib/env";
import { commitTempFile, cleanupTempFile, deleteObject, sweepOrphanedTempFiles } from "@/lib/storage";
import { streamUploadToTemp, type StreamUploadKind } from "@/lib/streaming-upload";
import { getLibraryUsageBytes } from "./list-assets";

// ADR-0002 / build plan B-9: 20 MB is above the Server Action body limit
// (10 MB, next.config.ts), so uploads go through a raw streaming route
// handler instead — this is that handler's actual logic, kept separate from
// the route file so it's unit- and integration-testable (route handlers
// aren't covered by vitest's include globs).
export const MAX_BYTES = 20_000_000;
const ALLOWED: StreamUploadKind[] = ["pdf", "png", "jpeg"];
const EXT_FOR_KIND: Record<StreamUploadKind, string> = { pdf: "pdf", png: "png", jpeg: "jpg" };
const MIME_FOR_KIND: Record<StreamUploadKind, string> = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg" };

const STATUS_FOR_STREAM_ERROR: Record<string, number> = {
  fileRequired: 400,
  fileTooLarge: 413,
  invalidFileType: 400,
  uploadFailed: 500,
};

export type UploadOutcome =
  | { ok: true; id: string; duplicate: boolean; warnNearCap: boolean }
  | { ok: false; status: number; error: string };

function softCapBytes(): number {
  return env.MARKETING_LIBRARY_SOFT_CAP_MB * 1_000_000;
}

export async function receiveMarketingUpload(params: {
  actorUserId: string;
  collectionId: string;
  fileName: string;
  body: ReadableStream<Uint8Array> | null;
  // From the Content-Length header, BEFORE any bytes are read — lets both
  // caps refuse early. null when the client didn't send one (rare, but the
  // in-stream cap in streamUploadToTemp still enforces MAX_BYTES either way).
  contentLength: number | null;
}): Promise<UploadOutcome> {
  const collection = await prisma.marketingCollection.findUnique({
    where: { id: params.collectionId },
    select: { id: true, archivedAt: true },
  });
  if (!collection || collection.archivedAt !== null) return { ok: false, status: 404, error: "notFound" };

  // Swept in-app at the start of an upload (capped, cheap),
  // not a host cron — best-effort, never blocks the actual upload on it.
  await sweepOrphanedTempFiles().catch(() => {});

  // Early refusal on the DECLARED size, before a single byte is read —
  // the in-stream cap in streamUploadToTemp is the real guard against a
  // lying/missing header, this is just avoiding wasted work for an honest
  // one that's obviously over.
  if (params.contentLength !== null && params.contentLength > MAX_BYTES) {
    return { ok: false, status: 413, error: "fileTooLarge" };
  }

  const cap = softCapBytes();
  const usageBefore = await getLibraryUsageBytes();
  if (params.contentLength !== null && usageBefore + params.contentLength >= cap) {
    return { ok: false, status: 413, error: "libraryFull" };
  }

  const streamed = await streamUploadToTemp(params.body, { maxBytes: MAX_BYTES, allow: ALLOWED });
  if (!streamed.ok) {
    return { ok: false, status: STATUS_FOR_STREAM_ERROR[streamed.error], error: streamed.error };
  }

  // Re-check against the ACTUAL size now known (the Content-Length header
  // could have understated it) — refuse and clean up rather than commit a
  // row that pushes the library over 100%.
  if (usageBefore + streamed.sizeBytes >= cap) {
    await cleanupTempFile(streamed.tempPath);
    return { ok: false, status: 413, error: "libraryFull" };
  }
  const warnNearCap = usageBefore + streamed.sizeBytes >= cap * 0.8;

  const key = `marketing/${randomUUID()}.${EXT_FOR_KIND[streamed.kind]}`;
  try {
    await commitTempFile(streamed.tempPath, key);
  } catch {
    await cleanupTempFile(streamed.tempPath);
    return { ok: false, status: 500, error: "uploadFailed" };
  }

  try {
    const asset = await prisma.marketingAsset.create({
      data: {
        collectionId: params.collectionId,
        fileKey: key,
        fileName: params.fileName,
        mimeType: MIME_FOR_KIND[streamed.kind],
        sizeBytes: streamed.sizeBytes,
        sha256: streamed.sha256,
        uploadedById: params.actorUserId,
      },
    });
    await logAudit({ action: "marketing.asset_uploaded", entityType: "MarketingAsset", entityId: asset.id, actorUserId: params.actorUserId });
    return { ok: true, id: asset.id, duplicate: false, warnNearCap };
  } catch (e) {
    // ADR-0002 U2: the DB-level partial unique index (collection_id, sha256)
    // WHERE archived_at IS NULL is the real dedupe guard against two
    // concurrent uploads of the same file — a check-then-insert in
    // application code can't close that race. On the violation, delete the
    // file THIS call just wrote (the loser) and point at the row that won.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await deleteObject(key);
      const existingAsset = await prisma.marketingAsset.findFirst({
        where: { collectionId: params.collectionId, sha256: streamed.sha256, archivedAt: null },
        select: { id: true },
      });
      if (!existingAsset) return { ok: false, status: 500, error: "uploadFailed" };
      return { ok: true, id: existingAsset.id, duplicate: true, warnNearCap: false };
    }
    await deleteObject(key);
    throw e;
  }
}
