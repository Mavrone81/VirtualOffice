import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/rbac";
import { env } from "@/lib/env";
import { isSameOrigin } from "@/lib/same-origin";
import { receiveMarketingUpload } from "@/server/marketing/upload";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // Build-now-ship-later (build plan B-9): the 20 MB upload needs the owner's
  // nginx client_max_body_size override on 165 first. With the flag off this
  // route must not exist as far as any caller can tell — 404, not 403, so a
  // disabled feature doesn't even reveal that an upload endpoint is there.
  if (!env.MARKETING_LIBRARY_ENABLED) return new NextResponse("Not found", { status: 404 });

  // U1: Origin check FIRST — before auth, before touching the body. A
  // Server Action gets Next's built-in Origin/Host check; a raw route
  // handler like this one doesn't, so it uses the same reviewed helper
  // every other cookie-authenticated POST route handler does.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // N7: auth() gives the same live-revalidated (SEC-2) admin check the pages use.
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const collectionId = url.searchParams.get("collectionId");
  const fileName = (req.headers.get("x-file-name") ?? "upload").slice(0, 255);
  if (!collectionId) {
    return NextResponse.json({ ok: false, error: "collectionRequired" }, { status: 400 });
  }
  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader !== null ? Number(contentLengthHeader) : null;

  const result = await receiveMarketingUpload({ actorUserId: session.user.id, collectionId, fileName, body: req.body, contentLength });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, id: result.id, duplicate: result.duplicate, warnNearCap: result.warnNearCap });
}
