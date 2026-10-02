import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { getObject, objectResponseHeaders } from "@/lib/storage";
import { auditTx } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return new NextResponse("Not found", { status: 404 });

  if (!isAdminRole(session.user.role)) {
    // B-5: a retired template upload (superseded by a replace) is 404 to
    // everyone but admins — a live download URL keeps distributing a
    // superseded copy of an agreement template even after it's no longer
    // listed anywhere (PD's ruling, under the owner's "replace" wording).
    // Admins can still fetch it by id for audit/recovery.
    if (doc.retiredAt) return new NextResponse("Not found", { status: 404 });
    if (doc.visibility === "Admin") return new NextResponse("Forbidden", { status: 403 });
    const assocId = session.user.associateId;
    const assoc = assocId ? await prisma.associate.findUnique({ where: { id: assocId }, select: { teamName: true } }) : null;
    const entitled =
      doc.assignment === "All" ||
      (doc.assignment === "Team" && !!assoc?.teamName && doc.assignedTeam === assoc.teamName) ||
      (doc.assignment === "Associate" && !!assocId && doc.assignedAssociateId === assocId);
    if (!entitled) return new NextResponse("Forbidden", { status: 403 });
  }

  // Tier A: signed agreements carry NRICs — record the download before streaming.
  if (doc.type === "AssociateAgreement" || doc.type === "VendorAgreement") {
    try {
      await auditTx(prisma, { action: "document.pii_viewed", entityType: "Document", entityId: doc.id, actorUserId: session.user.id, after: { type: doc.type } });
    } catch {
      return new NextResponse("Temporarily unavailable — please try again", { status: 503 });
    }
  }

  const data = await getObject(doc.fileKey);
  if (!data) return new NextResponse("File missing", { status: 404 });

  const filename = doc.fileKey.split("/").pop() || "document";
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: objectResponseHeaders(doc.fileKey, { filename, cacheControl: "private, max-age=60" }),
  });
}
