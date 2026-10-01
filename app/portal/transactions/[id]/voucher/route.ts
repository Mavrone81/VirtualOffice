import { NextResponse } from "next/server";
import type { AppRole } from "@prisma/client";
import { auth } from "@/auth";
import { isSameOrigin } from "@/lib/same-origin";
import { getIssuedVoucher, getOrCreateVoucher, VoucherAccessDenied } from "@/server/vouchers/get-or-create";
import { renderVoucherPdf } from "@/lib/pdf/voucher";
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parsed from the raw Cookie header rather than next/headers' cookies() —
// that requires a real Next.js request-scope AsyncLocalStorage context,
// which a directly-invoked route handler (as this route's own tests do)
// doesn't have. Reading the header off the Request works either way.
function localeFromRequest(req: Request): Locale {
  const raw = req.headers.get("cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`));
  if (!match) return defaultLocale;
  // A malformed cookie (e.g. a stray "%ZZ") must not 500 a voucher download —
  // decodeURIComponent throws URIError on bad escapes, so fall back instead.
  let value: string;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return defaultLocale;
  }
  return isLocale(value) ? value : defaultLocale;
}

/**
 * A-7: a per-transaction, per-payout payment voucher, served by record id.
 * `id` is the SalesTransaction id (the row id "My Transaction Received"
 * already has); `?payoutId=` picks which settling payout's voucher to
 * serve — one instalment sale paid across N payouts has N distinct
 * vouchers. An associate always gets their own, an admin may pass
 * `?associateId=` to view a specific associate's. Frozen at issue: the
 * first request for a given (transaction, associate, payout) creates it;
 * every later request returns the exact same content.
 *
 * Shared by GET and POST below; returns either the parsed, UUID-validated
 * params + session, or the Response to send back verbatim.
 */
type ParseResult =
  | { ok: false; response: NextResponse }
  | { ok: true; transactionId: string; payoutId: string; targetAssociateId: string; session: { user: { id: string; associateId: string | null; role: AppRole } } };

async function parseRequest(req: Request, id: Promise<{ id: string }>): Promise<ParseResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: new NextResponse("Unauthorized", { status: 401 }) };

  const { id: transactionId } = await id;
  if (!UUID_RE.test(transactionId)) return { ok: false, response: new NextResponse("Not found", { status: 404 }) };

  const searchParams = new URL(req.url).searchParams;
  const payoutId = searchParams.get("payoutId");
  if (!payoutId || !UUID_RE.test(payoutId)) return { ok: false, response: new NextResponse("Not found", { status: 404 }) };

  // ?associateId= lets an admin view a specific associate's voucher. It is
  // NOT admin-only at this point — the shared canReadVoucher rule inside
  // get-or-create.ts is the actual check — so a non-admin who tries someone
  // else's id (an IDOR probe) is correctly refused with 403, rather than
  // the query param being silently ignored in a way that would only ever
  // return their own 404.
  const targetAssociateId = searchParams.get("associateId") ?? session.user.associateId;
  if (!targetAssociateId || !UUID_RE.test(targetAssociateId)) return { ok: false, response: new NextResponse("Not found", { status: 404 }) };

  return { ok: true, transactionId, payoutId, targetAssociateId, session };
}

function pdfResponse(pdf: { buffer: Buffer; filename: string }): NextResponse {
  return new NextResponse(new Uint8Array(pdf.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * GET only RETRIEVES an already-issued voucher — it never creates one. A
 * GET is a verb the platform fires without a human (link prefetch, browser
 * speculation, crawlers), and any of those must not freeze an immutable
 * financial record nobody asked for. 404 when nothing has been issued yet;
 * issuing is the POST below.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const parsed = await parseRequest(req, params);
  if (!parsed.ok) return parsed.response;
  const { transactionId, payoutId, targetAssociateId, session } = parsed;

  let voucher;
  try {
    voucher = await getIssuedVoucher(transactionId, targetAssociateId, payoutId, { associateId: session.user.associateId, role: session.user.role });
  } catch (e) {
    if (e instanceof VoucherAccessDenied) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
  if (!voucher) return new NextResponse("Not found", { status: 404 });

  return pdfResponse(await renderVoucherPdf(voucher, localeFromRequest(req)));
}

/**
 * POST issues the voucher (or returns the already-issued one, unchanged) —
 * the only path that can create the immutable record. Origin check first,
 * before auth or anything else, same reviewed helper every other
 * cookie-authenticated POST route handler uses (a Server Action gets this
 * from Next itself; a raw route handler doesn't).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isSameOrigin(req)) return new NextResponse("Forbidden", { status: 403 });

  const parsed = await parseRequest(req, params);
  if (!parsed.ok) return parsed.response;
  const { transactionId, payoutId, targetAssociateId, session } = parsed;

  let voucher;
  try {
    voucher = await getOrCreateVoucher(transactionId, targetAssociateId, payoutId, { associateId: session.user.associateId, role: session.user.role }, session.user.id);
  } catch (e) {
    if (e instanceof VoucherAccessDenied) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
  if (!voucher) return new NextResponse("Not found", { status: 404 });

  return pdfResponse(await renderVoucherPdf(voucher, localeFromRequest(req)));
}
