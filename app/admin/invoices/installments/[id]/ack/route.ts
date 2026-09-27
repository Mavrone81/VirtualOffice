import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { getObject, objectResponseHeaders } from "@/lib/storage";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// B-7: serve the payment acknowledgement for an installment schedule row, by
// its own id (ADR-0001 — never a raw storage key in the URL). Admin-only,
// same posture as the invoice ack route.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!isAdminRole(session.user.role)) return new NextResponse("Forbidden", { status: 403 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return new NextResponse("Not found", { status: 404 });

  const entry = await prisma.installmentSchedule.findUnique({ where: { id }, select: { paymentAckFileKey: true, sequence: true } });
  if (!entry?.paymentAckFileKey) return new NextResponse("Not found", { status: 404 });

  const data = await getObject(entry.paymentAckFileKey);
  if (!data) return new NextResponse("File missing", { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: objectResponseHeaders(entry.paymentAckFileKey, {
      filename: `ack-installment-${entry.sequence}${entry.paymentAckFileKey.slice(entry.paymentAckFileKey.lastIndexOf("."))}`,
      cacheControl: "private, max-age=60",
    }),
  });
}
