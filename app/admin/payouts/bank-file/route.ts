import type { NextRequest } from "next/server";
import { generateBankFile } from "@/server/payouts/actions";

// POST only. The GIRO bulk-payout file is money leaving the business, so it can
// no longer be pulled with a bare GET link + a session cookie — the caller must
// re-enter their password, which generateBankFile verifies and audits.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const month = String(form.get("month") ?? "");
  const password = String(form.get("password") ?? "");

  const result = await generateBankFile(month, password);
  if (!result.ok) {
    // forbidden / badMonth / reauthFailed — all authorization/precondition
    // failures; the client shows the message inline.
    return new Response(result.error, { status: 403 });
  }
  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="giro-payout-${month}.csv"`,
    },
  });
}
