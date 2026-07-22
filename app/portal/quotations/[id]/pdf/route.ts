import { NextResponse } from "next/server";
import { SubmissionStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { renderQuotationPdf } from "@/lib/pdf/quotation";

export const dynamic = "force-dynamic";

// Rep-facing quotation for an approved sale (16-Jul quotation workflow). Only the
// closing associate (or an admin) may fetch it, and only once it is approved.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const sub = await prisma.salesSubmission.findUnique({
    where: { id },
    select: { closingAssociateId: true, status: true },
  });
  if (!sub) return new NextResponse("Not found", { status: 404 });

  const owns = !!session.user.associateId && session.user.associateId === sub.closingAssociateId;
  if (!isAdminRole(session.user.role) && !owns) return new NextResponse("Forbidden", { status: 403 });
  if (sub.status !== SubmissionStatus.QuotationApproved) return new NextResponse("Not available yet", { status: 409 });

  const pdf = await renderQuotationPdf(id);
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
