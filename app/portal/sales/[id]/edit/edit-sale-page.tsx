// Not a page.tsx: Next.js validates page files and permits only `default`,
// `metadata` and a few known fields as exports — a named export there fails
// the build with "is not a valid Page export field". The implementation lives
// here so both the portal and the admin route can call it with their own
// basePath; each route file exports only a default.

import { redirect, notFound } from "next/navigation";
import { format } from "date-fns";
import { ApprovalStatus, AssociateStatus, SubmissionStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { SaleForm, type SaleFormInitial } from "../../new/sale-form";
import { fetchActiveSalesWizardProducts, toFormProducts } from "@/server/products/sales-wizard-products";


export async function EditSalePageWithBase({ params, basePath }: { params: Promise<{ id: string }>; basePath: string }) {
  const session = await auth();
  const associateId = session?.user.associateId ?? null;
  if (!associateId) redirect("/portal/dashboard");
  const t = await getTranslations("portal");
  const { id } = await params;

  const s = await prisma.salesSubmission.findUnique({ where: { id }, include: { lineItems: true } });
  if (!s || s.closingAssociateId !== associateId) notFound();
  // Only editable while still Submitted (before admin approves the quotation).
  if (s.status !== SubmissionStatus.Submitted) redirect(`${basePath}/${id}`);

  const products = await fetchActiveSalesWizardProducts();
  const formProducts = toFormProducts(products);

  const associates = await prisma.associate.findMany({
    where: { associateStatus: AssociateStatus.Active, approvalStatus: ApprovalStatus.Approved, archivedAt: null },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });

  // Reconstruct the form's initial state from the saved submission.
  const lines = s.lineItems.map((li) => {
    const p = products.find((pp) => pp.productCode === li.productCode);
    const selected = (li.selectedComCodes as { comCode: string }[] | null) ?? [];
    const comCodeIds = p ? p.comCodes.filter((c) => selected.some((sc) => sc.comCode === c.comCode)).map((c) => c.id) : [];
    return { productId: p?.id ?? "", amount: Number(li.lineSaleAmount).toString(), comCodeIds };
  });
  const mkSplit = (aid: string | null, vt: string | null, val: { toString(): string } | null) =>
    aid ? { associateId: aid, valueType: (vt === "Absolute" ? "Absolute" : "Percentage") as "Percentage" | "Absolute", value: val ? Number(val).toString() : "" } : { associateId: "", valueType: "Percentage" as const, value: "" };

  const initial: SaleFormInitial = {
    clientName: s.clientName,
    clientContact: s.clientContact ?? "",
    salesDate: format(s.salesDate, "yyyy-MM-dd"),
    quoteDate: s.quoteDate ? format(s.quoteDate, "yyyy-MM-dd") : "",
    plan: s.paymentPlan === "Installment" ? "Installment" : "Full Payment",
    deposit: s.deposit ? Number(s.deposit).toString() : "",
    installmentCount: s.installmentCount === 24 ? "24" : "12",
    lines: lines.length ? lines : [{ productId: "", amount: "", comCodeIds: [] }],
    split2: mkSplit(s.associate2Id, s.associate2ValueType, s.associate2Value),
    split3: mkSplit(s.associate3Id, s.associate3ValueType, s.associate3Value),
  };

  return (
    <>
      <PageHeader title={t("editSale.pageTitle")} subtitle={t("editSale.pageSubtitle")} />
      <SaleForm
        products={formProducts}
        associates={associates.map((a) => ({ id: a.id, name: a.fullName }))}
        today={format(new Date(), "yyyy-MM-dd")}
        initial={initial}
        submissionId={s.id}
      />
    </>
  );
}
