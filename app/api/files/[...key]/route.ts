import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { fileKeyFromSegments } from "@/lib/file-key";
import { getObject, objectResponseHeaders } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { key: segments } = await params;
  // Segments arrive already decoded once by Next; validate, never re-decode (SEC-1).
  const key = fileKeyFromSegments(segments);
  if (!key) return new NextResponse("Bad request", { status: 400 });

  // Admins/Accounts may read any object. Associates may read objects under their
  // own associate namespace, plus documents on a sale they closed (their
  // supporting/signed docket — key `submissions/<id>/…`).
  if (!isAdminRole(session.user.role)) {
    const assocId = session.user.associateId;
    let allowed = !!assocId && key.startsWith(`associates/${assocId}/`);
    if (!allowed && assocId && key.startsWith("submissions/")) {
      const subId = key.split("/")[1];
      if (/^[0-9a-f-]{36}$/i.test(subId)) {
        const sub = await prisma.salesSubmission.findUnique({ where: { id: subId }, select: { closingAssociateId: true } });
        allowed = !!sub && sub.closingAssociateId === assocId;
      }
    }
    if (!allowed) return new NextResponse("Forbidden", { status: 403 });
  }

  const data = await getObject(key);
  if (!data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: objectResponseHeaders(key, { cacheControl: "private, max-age=300" }),
  });
}
