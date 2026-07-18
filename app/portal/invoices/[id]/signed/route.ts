import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canManageSignedInvoice } from "@/lib/invoice-access";
import { getObject, contentTypeForKey } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Serve the uploaded client-signed invoice PDF (16-Jul signed-invoice precursor).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { transaction: { select: { closingAssociateId: true } } },
  });
  if (!invoice?.signedPdfFileKey) return new NextResponse("Not found", { status: 404 });
  if (!canManageSignedInvoice({ closingAssociateId: invoice.transaction.closingAssociateId }, { associateId: session.user.associateId, role: session.user.role })) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const data = await getObject(invoice.signedPdfFileKey);
  if (!data) return new NextResponse("File missing", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForKey(invoice.signedPdfFileKey),
      "Content-Disposition": `inline; filename="signed-${invoice.invoiceNumber}.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
