import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canViewPaymentAck } from "@/lib/invoice-access";
import { getObject, objectResponseHeaders } from "@/lib/storage";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// B-7 (owner ruling): serve the payment acknowledgement for an invoice, by
// record id (ADR-0001 — never a raw storage key in the URL). Admin, the
// closing associate, or their upline (direct/2nd) — see canViewPaymentAck.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  // K3 (DevSecOps): a malformed id would otherwise reach a @db.Uuid column
  // comparison and throw (500) instead of a clean 404.
  if (!UUID_RE.test(id)) return new NextResponse("Not found", { status: 404 });

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      paymentAckFileKey: true,
      invoiceNumber: true,
      transaction: { select: { closingAssociateId: true, closingAssociate: { select: { directUplineId: true, secondUplineId: true } } } },
    },
  });
  if (!invoice) return new NextResponse("Not found", { status: 404 });
  if (
    !canViewPaymentAck(
      {
        closingAssociateId: invoice.transaction.closingAssociateId,
        closingAssociateDirectUplineId: invoice.transaction.closingAssociate.directUplineId,
        closingAssociateSecondUplineId: invoice.transaction.closingAssociate.secondUplineId,
      },
      { associateId: session.user.associateId, role: session.user.role },
    )
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!invoice.paymentAckFileKey) return new NextResponse("Not found", { status: 404 });

  const data = await getObject(invoice.paymentAckFileKey);
  if (!data) return new NextResponse("File missing", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: objectResponseHeaders(invoice.paymentAckFileKey, {
      filename: `ack-${invoice.invoiceNumber}${invoice.paymentAckFileKey.slice(invoice.paymentAckFileKey.lastIndexOf("."))}`,
      cacheControl: "private, max-age=60",
    }),
  });
}
