"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { InvoiceStatus, InvoicePaymentMethod } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { canManageSignedInvoice } from "@/lib/invoice-access";
import { logAudit } from "@/lib/audit";
import { putObject } from "@/lib/storage";
import { assertUpload } from "@/lib/file-type";
import { recomputeEligibility } from "@/server/commission/eligibility";

const MAX_SIGNED_BYTES = 15_000_000;

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

/**
 * Upload the client-signed copy of a generated invoice (16-Jul signed-invoice
 * precursor). The closing associate — or back-office — attaches the signed PDF
 * before the sale is tracked for payment. PDF only, magic-byte verified.
 */
export async function uploadSignedInvoice(invoiceId: string, file: File): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session) return { ok: false, error: t("forbidden") };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { transaction: { select: { closingAssociateId: true } } },
  });
  if (!invoice) return { ok: false, error: t("notFound") };
  if (!canManageSignedInvoice({ closingAssociateId: invoice.transaction.closingAssociateId }, { associateId: session.user.associateId, role: session.user.role })) {
    return { ok: false, error: t("forbidden") };
  }
  if (!file || file.size === 0) return { ok: false, error: t("fileRequired") };
  if (file.size > MAX_SIGNED_BYTES) return { ok: false, error: t("fileTooLarge") };

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    assertUpload(bytes, ["pdf"]);
  } catch {
    return { ok: false, error: t("invalidFileType") };
  }

  const key = `invoices/${invoice.id}/signed-${randomUUID()}.pdf`;
  await putObject(key, Buffer.from(bytes));
  await prisma.invoice.update({ where: { id: invoice.id }, data: { signedPdfFileKey: key } });
  await logAudit({ action: "invoice.signed_uploaded", entityType: "Invoice", entityId: invoice.id, actorUserId: session.user.id });
  revalidatePath("/portal/invoices");
  revalidatePath("/admin/invoices");
  return { ok: true };
}

export async function markInvoicePaid(
  invoiceId: string,
  payment?: { method: InvoicePaymentMethod; reference?: string },
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, error: t("notFound") };

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.Paid,
      paidDate: new Date(),
      paidMarkedById: session.user.id,
      paidMethod: payment?.method ?? null,
      paidReference: payment?.reference?.trim() || null,
    },
  });
  await recomputeEligibility(invoice.transactionId);
  await logAudit({ action: "invoice.marked_paid", entityType: "Invoice", entityId: invoiceId, actorUserId: session.user.id, after: { method: payment?.method ?? null, reference: payment?.reference?.trim() || null } });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return { ok: true };
}

export async function markInstallmentPaid(scheduleId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const entry = await prisma.installmentSchedule.findUnique({
    where: { id: scheduleId },
    include: { plan: true },
  });
  if (!entry) return { ok: false, error: t("notFound") };

  await prisma.installmentSchedule.update({
    where: { id: scheduleId },
    data: { paid: true, paidDate: new Date() },
  });
  await recomputeEligibility(entry.plan.transactionId);
  await logAudit({ action: "installment.marked_paid", entityType: "InstallmentSchedule", entityId: scheduleId, actorUserId: session.user.id });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return { ok: true };
}

/** Revert a direct invoice to Unpaid (correction); recomputes commission eligibility. */
export async function markInvoiceUnpaid(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, error: t("notFound") };

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.Outstanding, paidDate: null, paidMarkedById: null, paidMethod: null, paidReference: null },
  });
  await recomputeEligibility(invoice.transactionId);
  await logAudit({ action: "invoice.marked_unpaid", entityType: "Invoice", entityId: invoiceId, actorUserId: session.user.id });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return { ok: true };
}

/** Revert an installment to Unpaid (correction); recomputes commission eligibility. */
export async function markInstallmentUnpaid(scheduleId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const entry = await prisma.installmentSchedule.findUnique({ where: { id: scheduleId }, include: { plan: true } });
  if (!entry) return { ok: false, error: t("notFound") };

  await prisma.installmentSchedule.update({ where: { id: scheduleId }, data: { paid: false, paidDate: null } });
  await recomputeEligibility(entry.plan.transactionId);
  await logAudit({ action: "installment.marked_unpaid", entityType: "InstallmentSchedule", entityId: scheduleId, actorUserId: session.user.id });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return { ok: true };
}
