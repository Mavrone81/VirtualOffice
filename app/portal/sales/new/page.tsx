import { format } from "date-fns";
import { ProductActiveStatus, ApprovalStatus, AssociateStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { SaleForm, type FormProduct, type SaleFormInitial } from "./sale-form";
import { getTranslations } from "next-intl/server";
import type { QuotationLineSnapshot } from "@/server/quotations/actions";

export const metadata = { title: "Submit a sale · Enshrine Portal" };

export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ fromQuotation?: string }> }) {
  const t = await getTranslations("portal");
  const session = await auth();
  const a17On = env.A17_CLOSED_DEAL_FLOW;

  const products = await prisma.product.findMany({
    where: { activeStatus: ProductActiveStatus.Active, archivedAt: null },
    include: { comCodes: { where: { active: true } }, defaultCompany: true },
    orderBy: { productCode: "asc" },
  });

  const formProducts: FormProduct[] = products.map((p) => ({
    id: p.id,
    productCode: p.productCode,
    productName: p.productName,
    companyName: p.defaultCompany?.name ?? "—",
    requiresAshesAgreement: p.requiresAshesAgreement,
    comCodes: p.comCodes.map((c) => ({ id: c.id, label: c.label, valueType: c.valueType, value: c.value.toString() })),
  }));

  // Split partners — active approved associates. (Team-scoping arrives with #7 Teams.)
  const associates = await prisma.associate.findMany({
    where: { associateStatus: AssociateStatus.Active, approvalStatus: ApprovalStatus.Approved, archivedAt: null },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  const formAssociates = associates.map((a) => ({ id: a.id, name: a.fullName }));

  // A-17 screen 2 (docs/design/a17-quotation-flow.md): "Convert to transaction"
  // prefills this wizard from an Issued quotation — informational only, the
  // submission's own lines are authoritative (design note §2). This is a read
  // -only prefill: it doesn't call submitSale or touch the quotation's status.
  // The quotation moves to Converted once submitSale itself accepts a
  // quotationId, which isn't built yet (Backend, in progress).
  const { fromQuotation } = await searchParams;
  let initial: SaleFormInitial | undefined;
  let fromQuotationCode: string | undefined;
  let fromQuotationId: string | undefined;
  if (a17On && fromQuotation && session?.user.associateId) {
    const q = await prisma.quotation.findUnique({ where: { id: fromQuotation } });
    if (q && q.associateId === session.user.associateId && q.status === "Issued") {
      const productByCode = new Map(products.map((p) => [p.productCode, p]));
      const qLines = q.lines as unknown as QuotationLineSnapshot[];
      const lines = qLines
        .map((l) => {
          const p = productByCode.get(l.productCode);
          if (!p) return null;
          const comCodeIds = l.addOns.map((a) => p.comCodes.find((c) => c.comCode === a.comCode)?.id).filter((id): id is string => !!id);
          return { productId: p.id, amount: l.amount, comCodeIds };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null);
      if (lines.length > 0) {
        initial = {
          clientName: q.clientName,
          clientContact: q.clientContact ?? "",
          salesDate: format(new Date(), "yyyy-MM-dd"),
          quoteDate: format(q.quoteDate, "yyyy-MM-dd"),
          plan: "Full Payment",
          deposit: "",
          installmentCount: "12",
          lines,
          split2: { associateId: "", valueType: "Percentage", value: "" },
          split3: { associateId: "", valueType: "Percentage", value: "" },
        };
        fromQuotationCode = q.quotationCode;
        fromQuotationId = q.id;
      }
    }
  }

  return (
    <>
      <PageHeader title={t("newSale.pageTitle")} subtitle={t("newSale.pageSubtitle")} />
      <SaleForm
        products={formProducts}
        associates={formAssociates}
        today={format(new Date(), "yyyy-MM-dd")}
        initial={initial}
        fromQuotationCode={fromQuotationCode}
        fromQuotationId={fromQuotationId}
      />
    </>
  );
}
