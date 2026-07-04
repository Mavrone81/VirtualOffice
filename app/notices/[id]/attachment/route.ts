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
  const notice = await prisma.notice.findUnique({ where: { id } });
  if (!notice?.attachmentFileKey) return new NextResponse("Not found", { status: 404 });

  // Admins see any; associates only if the notice is addressed to them.
  if (!isAdminRole(session.user.role)) {
    const assoc = session.user.associateId
      ? await prisma.associate.findUnique({ where: { id: session.user.associateId }, select: { teamName: true } })
      : null;
    const entitled =
      notice.audience === "All" ||
      (notice.audience === "Role" && notice.audienceRole === session.user.role) ||
      (notice.audience === "Team" && !!assoc?.teamName && notice.audienceTeam === assoc.teamName);
    if (!entitled) return new NextResponse("Forbidden", { status: 403 });
  }

  const data = await getObject(notice.attachmentFileKey);
  if (!data) return new NextResponse("File missing", { status: 404 });
  const filename = notice.attachmentFileKey.split("/").pop() || "attachment";
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: { "Content-Type": contentTypeForKey(notice.attachmentFileKey), "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, max-age=60" },
  });
}
