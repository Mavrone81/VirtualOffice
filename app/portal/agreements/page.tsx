import { format } from "date-fns";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { QuotationForm, type QuotationFormProduct, type QuotationRow } from "./quotation-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quotation Request · Enshrine Portal" };

// C-6 (2026-10-02): this page used to be "Doc Template" — blank Pets/Human
// Afterlife templates plus the signed-agreements list. Both folded into
// /portal/documents (one documents home instead of two), leaving only the
// A-17 quotation-request form here.
//
// ⚠ Known, named follow-up (NOT guessed at, NOT built here — scope was
// explicitly held back pending a product decision, settled as "(c): its own
// route"): this page's URL and the "agreements" code around it still carry
// the old identity. The route hasn't moved yet because nobody has built its
// new home — this is temporary, not a design choice, and should not be
// "simplified" back into a multi-tab page if revisited before the move.
export default async function PortalAgreementsPage() {
  const session = await auth();
  const t = await getTranslations("agreements");
  if (!session?.user) return null;
  const a17On = env.A17_CLOSED_DEAL_FLOW;
  // Nothing left on this page once the flag is off — the quotation form is
  // itself flag-gated, and Pets/Human content now lives at /portal/documents.
  if (!a17On) redirect("/portal/documents");

  let quotationProducts: QuotationFormProduct[] = [];
  let quotationRows: QuotationRow[] = [];
  if (session.user.associateId) {
    const [products, quotations] = await Promise.all([
      prisma.product.findMany({
        where: { activeStatus: "Active", archivedAt: null },
        select: { id: true, productCode: true, productName: true },
        orderBy: { productCode: "asc" },
      }),
      prisma.quotation.findMany({
        where: { associateId: session.user.associateId },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    quotationProducts = products;
    quotationRows = quotations.map((q) => ({
      id: q.id,
      quotationCode: q.quotationCode,
      clientName: q.clientName,
      quoteDate: q.quoteDate.toISOString().slice(0, 10),
      total: q.total.toString(),
      status: q.status,
      lines: q.lines as QuotationRow["lines"],
    }));
  }

  return (
    <>
      <PageHeader title={t("docTemplate.title")} subtitle={t("docTemplate.subtitle")} />
      <QuotationForm products={quotationProducts} today={format(new Date(), "yyyy-MM-dd")} quotations={quotationRows} />
    </>
  );
}
