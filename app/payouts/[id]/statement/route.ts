import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { renderStatementPdf } from "@/lib/pdf/statement";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;

  // Admins/Accounts see any statement; associates only their own.
  if (!isAdminRole(session.user.role)) {
    const payout = await prisma.monthlyPayout.findUnique({ where: { id }, select: { associateId: true } });
    if (!payout || payout.associateId !== session.user.associateId) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const pdf = await renderStatementPdf(id, session.user.id);
  if (!pdf) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(pdf.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
