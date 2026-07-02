import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { getObject, contentTypeForKey } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return new NextResponse("Not found", { status: 404 });

  if (!isAdminRole(session.user.role)) {
    if (doc.visibility === "Admin") return new NextResponse("Forbidden", { status: 403 });
    const assocId = session.user.associateId;
    const assoc = assocId ? await prisma.associate.findUnique({ where: { id: assocId }, select: { teamName: true } }) : null;
    const entitled =
      doc.assignment === "All" ||
      (doc.assignment === "Team" && !!assoc?.teamName && doc.assignedTeam === assoc.teamName) ||
      (doc.assignment === "Associate" && !!assocId && doc.assignedAssociateId === assocId);
    if (!entitled) return new NextResponse("Forbidden", { status: 403 });
  }

  const data = await getObject(doc.fileKey);
  if (!data) return new NextResponse("File missing", { status: 404 });

  const filename = doc.fileKey.split("/").pop() || "document";
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForKey(doc.fileKey),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
