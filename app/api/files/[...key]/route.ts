import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/rbac";
import { getObject, contentTypeForKey } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { key: segments } = await params;
  const key = segments.map((s) => decodeURIComponent(s)).join("/");

  // Admins/Accounts may read any object. Associates may only read objects
  // filed under their own associate namespace.
  if (!isAdminRole(session.user.role)) {
    const assocId = session.user.associateId;
    if (!assocId || !key.startsWith(`associates/${assocId}/`)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const data = await getObject(key);
  if (!data) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForKey(key),
      "Cache-Control": "private, max-age=300",
    },
  });
}
