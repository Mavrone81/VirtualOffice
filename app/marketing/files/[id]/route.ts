import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { openObjectStream, objectResponseHeaders } from "@/lib/storage";
import { canServeAsset } from "@/server/marketing/list-assets";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ADR-0002 N6: any signed-in user, active assets only (never an archived
// asset or one whose collection is archived — "no expiry" hides, it doesn't
// delete). PDFs/images render inline because SEC-11 sniffing guarantees they
// really are what the stored key's extension says. Downloads aren't logged
// (non-PII collateral, per the ADR); admin archive/delete already are.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Build-now-ship-later: with the flag off, no marketing asset can exist
  // yet (uploads are also gated), but gate the read path too so this route
  // can't be probed before the feature ships.
  if (!env.MARKETING_LIBRARY_ENABLED) return new NextResponse("Not found", { status: 404 });

  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  // K3 (security-review precedent, B-7): a malformed id would otherwise reach a
  // @db.Uuid column comparison and throw (500) instead of a clean 404.
  if (!UUID_RE.test(id)) return new NextResponse("Not found", { status: 404 });

  const asset = await prisma.marketingAsset.findUnique({
    where: { id },
    include: { collection: { select: { archivedAt: true } } },
  });
  if (!asset || !canServeAsset(asset, asset.collection)) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Streams the file rather than buffering it (a download can be up to
  // 20 MB) — the bytes pass straight from disk to the response.
  const opened = await openObjectStream(asset.fileKey);
  if (!opened) return new NextResponse("File missing", { status: 404 });

  return new NextResponse(opened.stream, {
    status: 200,
    headers: {
      ...objectResponseHeaders(asset.fileKey, { filename: asset.fileName, cacheControl: "private, max-age=300" }),
      "Content-Length": String(opened.size),
    },
  });
}
