import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listVouchersForTransaction, VoucherAccessDenied } from "@/server/vouchers/get-or-create";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A-7: lists every settling payout on this transaction for the associate,
 * whether or not its voucher has been issued yet (viewed) — one row per
 * payout, oldest first. Never creates a voucher; that's an explicit action
 * via the singular /voucher route. Same id/ownership rule as that route.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id: transactionId } = await params;
  if (!UUID_RE.test(transactionId)) return new NextResponse("Not found", { status: 404 });

  const targetAssociateId = new URL(req.url).searchParams.get("associateId") ?? session.user.associateId;
  if (!targetAssociateId || !UUID_RE.test(targetAssociateId)) return new NextResponse("Not found", { status: 404 });

  let vouchers;
  try {
    vouchers = await listVouchersForTransaction(transactionId, targetAssociateId, { associateId: session.user.associateId, role: session.user.role });
  } catch (e) {
    if (e instanceof VoucherAccessDenied) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
  return NextResponse.json({ vouchers });
}
