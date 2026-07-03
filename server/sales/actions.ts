"use server";

import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import {
  PaymentPlan, SubmissionStatus, CommissionEligibility, InvoiceType, InvoiceStatus,
} from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { D, round2, sum } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { runCommission } from "@/server/commission/run";


export type SubmitSaleInput = {
  salesDate: string;
  clientName: string;
  clientContact?: string;
  paymentPlan: "Full Payment" | "Installment";
  deposit?: number;
  installmentCount?: number;
  lines: { productId: string; lineSaleAmount: number; comCodeIds: string[] }[];
};

export async function submitSale(input: SubmitSaleInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user.associateId) return { ok: false, error: t("noAssociateProfile") };
  if (!input.clientName?.trim()) return { ok: false, error: t("clientNameRequired") };
  if (!input.lines.length) return { ok: false, error: t("addProductLine") };

  const products = await prisma.product.findMany({
    where: { id: { in: input.lines.map((l) => l.productId) } },
    include: { comCodes: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lineData = input.lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p) throw new Error("Unknown product");
    const selected = p.comCodes
      .filter((c) => l.comCodeIds.includes(c.id))
      .map((c) => ({ comCode: c.comCode, label: c.label, valueType: c.valueType, value: c.value.toString() }));
    return {
      companyId: p.defaultCompanyId ?? products[0].defaultCompanyId!,
      productCode: p.productCode,
      productName: p.productName,
      commissionType: p.commissionType,
      lineSaleAmount: round2(l.lineSaleAmount),
      isExternal: p.isExternal,
      selectedComCodes: selected,
    };
  });

  const saleAmount = sum(lineData.map((l) => l.lineSaleAmount));

  await prisma.salesSubmission.create({
    data: {
      salesDate: new Date(input.salesDate),
      clientName: input.clientName.trim(),
      clientContact: input.clientContact?.trim() || null,
      saleAmount,
      paymentPlan: input.paymentPlan === "Installment" ? PaymentPlan.Installment : PaymentPlan.FullPayment,
      deposit: input.deposit ? round2(input.deposit) : null,
      installmentCount: input.paymentPlan === "Installment" ? input.installmentCount ?? null : null,
      amountCollected: 0,
      closingAssociateId: session.user.associateId,
      status: SubmissionStatus.Submitted,
      lineItems: { create: lineData },
    },
  });

  revalidatePath("/portal/sales");
  revalidatePath("/admin/sales/verify");
  return { ok: true };
}

export async function verifySubmission(submissionId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({
    where: { id: submissionId },
    include: { lineItems: true, closingAssociate: true },
  });
  if (!sub) return { ok: false, error: t("notFound") };
  if (sub.status !== SubmissionStatus.Submitted) return { ok: false, error: t("alreadyProcessed") };

  const closer = sub.closingAssociate;
  const fullPayment = sub.paymentPlan === PaymentPlan.FullPayment;

  const txId = await prisma.$transaction(async (db) => {
    const n = await db.salesTransaction.count();
    const code = `TXN-${String(n + 1).padStart(4, "0")}`;

    const transaction = await db.salesTransaction.create({
      data: {
        transactionCode: code,
        submissionId: sub.id,
        salesDate: sub.salesDate,
        clientName: sub.clientName,
        clientContact: sub.clientContact,
        saleAmount: sub.saleAmount,
        paymentPlan: sub.paymentPlan,
        deposit: sub.deposit,
        installmentCount: sub.installmentCount,
        amountCollected: fullPayment ? sub.saleAmount : sub.deposit ?? 0,
        closingAssociateId: sub.closingAssociateId,
        directUplineId: closer.directUplineId,
        secondUplineId: closer.secondUplineId,
        commissionEligibility: fullPayment ? CommissionEligibility.Eligible : CommissionEligibility.PendingCollection,
        verifiedById: session.user.id,
        verifiedAt: new Date(),
      },
    });

    // attach line items + resolve the structure version active on the sales date
    const byCompany = new Map<string, ReturnType<typeof D>>();
    for (const li of sub.lineItems) {
      const version = await db.commissionStructureVersion.findFirst({
        where: { productCode: li.productCode, effectiveDate: { lte: sub.salesDate } },
        orderBy: { effectiveDate: "desc" },
      });
      await db.saleLineItem.update({
        where: { id: li.id },
        data: { transactionId: transaction.id, structureVersionId: version?.id ?? null },
      });
      byCompany.set(li.companyId, (byCompany.get(li.companyId) ?? D(0)).add(D(li.lineSaleAmount)));
    }

    // Full Payment → one invoice per company entity, marked Paid (collected on
    // verify). Installments are represented by the schedule below instead.
    if (fullPayment) {
      for (const [companyId, amount] of byCompany) {
        const company = await db.company.update({
          where: { id: companyId },
          data: { invoiceNextSeq: { increment: 1 } },
        });
        const seq = company.invoiceNextSeq - 1;
        const invoiceNumber = `INV-${company.invoicePrefix}-${format(sub.salesDate, "yyyy")}-${String(seq).padStart(5, "0")}`;
        await db.invoice.create({
          data: {
            transactionId: transaction.id,
            companyId,
            invoiceNumber,
            invoiceType: InvoiceType.ComputerGenerated,
            amount,
            status: InvoiceStatus.Paid,
            paidDate: new Date(),
          },
        });
      }
    }

    // installment plan + schedule
    if (!fullPayment && sub.installmentCount && sub.installmentCount > 0) {
      const plan = await db.installmentPlan.create({
        data: {
          transactionId: transaction.id,
          totalAmount: sub.saleAmount,
          deposit: sub.deposit ?? 0,
          installmentCount: sub.installmentCount,
        },
      });
      const per = round2(D(sub.saleAmount).sub(D(sub.deposit ?? 0)).div(sub.installmentCount));
      for (let i = 1; i <= sub.installmentCount; i++) {
        await db.installmentSchedule.create({ data: { planId: plan.id, sequence: i, dueAmount: per, paid: false } });
      }
    }

    await db.salesSubmission.update({ where: { id: sub.id }, data: { status: SubmissionStatus.Verified } });
    return transaction.id;
  });

  await runCommission(txId);

  await logAudit({ action: "sale.verified", entityType: "SalesTransaction", entityId: txId, after: { submissionId } });
  revalidatePath("/admin/sales/verify");
  revalidatePath("/admin/sales/transactions");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/dashboard");
  return { ok: true };
}
