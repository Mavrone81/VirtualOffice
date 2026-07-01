import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/rbac";
import { renderInvoicePdf } from "@/lib/pdf/invoice";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const { id } = await params;
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
