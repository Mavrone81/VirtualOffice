import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { renderReferralAgreementPdfFromData } from "@/lib/pdf/referral-agreement";

export const dynamic = "force-dynamic";

/**
 * A12 (associate-portal changes, Sep 2026): the partner reads the actual
 * Referral & Marketing Partnership Agreement — with their details filled in —
 * before signing. The form POSTs its current values here with target="_blank",
 * so the agreement opens in the device's own PDF viewer (iPad / Android / desktop
 * all handle a top-level PDF; an embedded one is blank on most tablets).
 * POST, not GET: the details (incl. NRIC) never appear in a URL or access log.
 * Read-only — renders a document, stores nothing.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const form = await req.formData();
  const v = (k: string) => {
    const x = form.get(k);
    return typeof x === "string" && x.trim() ? x.trim() : null;
  };
  const vendorName = v("vendorName");
  if (!vendorName) return new NextResponse("Vendor name is required", { status: 400 });

  const pdf = await renderReferralAgreementPdfFromData({
    agreementDate: new Date(),
    vendorName,
    vendorUen: v("vendorUen"),
    vendorAddress: v("vendorAddress"),
    vendorSignerName: v("vendorSignerName"),
    vendorSignerNric: v("vendorSignerNric"),
    vendorSignerDesignation: v("vendorSignerDesignation"),
    vendorSignatureDataUrl: null,
    vendorSignedDate: null,
    companySignName: null,
    companySignDesignation: null,
    companySignatureDataUrl: null,
    companySignedAt: null,
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="referral-marketing-partnership-agreement.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
