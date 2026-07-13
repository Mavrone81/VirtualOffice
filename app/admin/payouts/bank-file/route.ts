import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/rbac";
import { buildBankFileCsv } from "@/server/payouts/bankfile";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return new Response("Forbidden", { status: 403 });

  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("Bad month", { status: 400 });

  const csv = await buildBankFileCsv(month, session.user.id);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="giro-payout-${month}.csv"`,
    },
  });
}
