import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canManageSignedInvoice } from "@/lib/invoice-access";
import { renderInvoicePdf } from "@/lib/pdf/invoice";

export const dynamic = "force-dynamic";

// Portal-side view of the generated invoice (16-Jul signed-invoice precursor):
// the closing associate prints this, gets it signed, then uploads the signed copy.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { transaction: { select: { closingAssociateId: true } } },
  });
  if (!invoice) return new NextResponse("Not found", { status: 404 });
  if (!canManageSignedInvoice({ closingAssociateId: invoice.transaction.closingAssociateId }, { associateId: session.user.associateId, role: session.user.role })) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const pdf = await renderInvoicePdf(id);
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
