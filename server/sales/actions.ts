"use server";

import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import {
  Prisma, PaymentPlan, SubmissionStatus, CommissionEligibility, InvoiceType, InvoiceStatus, ComValueType,
} from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole, isFullAdmin } from "@/lib/rbac";
import { isSdApproved } from "@/lib/approval";
import { D, round2, sum } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { runCommission } from "@/server/commission/run";
import { validate } from "@/lib/validate";
import { saleSchema } from "@/lib/schemas";


/**
 * Concurrency-safe transaction code. Postgres serializes `nextval`, so two
 * simultaneous verifications can never mint the same code — unlike the old
 * `count()+1`, where both counted N and both emitted TXN-{N+1}. Takes a tx
 * client so it runs inside verifySubmission's transaction; gaps on rollback are
 * acceptable for an opaque code.
 */
export async function nextTransactionCode(
  db: Prisma.TransactionClient | typeof prisma,
): Promise<string> {
  const rows = await db.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('transaction_code_seq')`;
  const n = Number(rows[0].nextval);
  return `TXN-${String(n).padStart(4, "0")}`;
}

export type SubmitSaleInput = {
  salesDate: string;
  clientName: string;
  clientContact?: string;
  paymentPlan: "Full Payment" | "Installment";
  deposit?: number;
  installmentCount?: number;
  lines: { productId: string; lineSaleAmount: number; comCodeIds: string[] }[];
  associate2?: { associateId: string; valueType: "Percentage" | "Absolute"; value: number };
  associate3?: { associateId: string; valueType: "Percentage" | "Absolute"; value: number };
};

export async function submitSale(input: SubmitSaleInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const v = validate(saleSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;

  const session = await auth();
  if (!session?.user.associateId) return { ok: false, error: t("noAssociateProfile") };

  const products = await prisma.product.findMany({
    where: { id: { in: validInput.lines.map((l) => l.productId) } },
    include: { comCodes: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lineData = validInput.lines.map((l) => {
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
      salesDate: new Date(validInput.salesDate),
      clientName: validInput.clientName.trim(),
      clientContact: validInput.clientContact?.trim() || null,
      saleAmount,
      paymentPlan: validInput.paymentPlan === "Installment" ? PaymentPlan.Installment : PaymentPlan.FullPayment,
      deposit: validInput.deposit ? round2(validInput.deposit) : null,
      installmentCount: validInput.paymentPlan === "Installment" ? validInput.installmentCount ?? null : null,
      amountCollected: 0,
      closingAssociateId: session.user.associateId,
      associate2Id: validInput.associate2?.associateId ?? null,
      associate2ValueType: validInput.associate2 ? (validInput.associate2.valueType as ComValueType) : null,
      associate2Value: validInput.associate2 ? round2(validInput.associate2.value) : null,
      associate3Id: validInput.associate3?.associateId ?? null,
      associate3ValueType: validInput.associate3 ? (validInput.associate3.valueType as ComValueType) : null,
      associate3Value: validInput.associate3 ? round2(validInput.associate3.value) : null,
      status: SubmissionStatus.Submitted,
      lineItems: { create: lineData },
    },
  });

  revalidatePath("/portal/sales");
  revalidatePath("/admin/sales/verify");
  return { ok: true };
}

/**
 * SD approval of a submission's share-com split (16-Jul §4). The team SD (or a
 * Business Admin) approves; after 3 days it auto-approves without this call.
 * Idempotent; only valid while the submission is still Submitted.
 */
export async function approveSubmissionSplit(submissionId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !(isFullAdmin(session.user.role) || session.user.role === "SalesDirector")) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({ where: { id: submissionId }, select: { status: true, sdApprovedAt: true } });
  if (!sub) return { ok: false, error: t("notFound") };
  if (sub.status !== SubmissionStatus.Submitted) return { ok: false, error: t("alreadyProcessed") };
  if (sub.sdApprovedAt) { revalidatePath("/admin/sales/verify"); return { ok: true }; }

  await prisma.salesSubmission.update({ where: { id: submissionId }, data: { sdApprovedAt: new Date(), sdApprovedById: session.user.id } });
  await logAudit({ action: "submission.sd_approved", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id });
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
  // Business Admin verifies only after the team SD has approved the split
  // (or it auto-approved 3 days after submission).
  if (!isSdApproved(sub).approved) return { ok: false, error: t("pendingSdApproval") };

  const closer = sub.closingAssociate;
  const fullPayment = sub.paymentPlan === PaymentPlan.FullPayment;

  const txId = await prisma.$transaction(async (db) => {
    const code = await nextTransactionCode(db);

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
