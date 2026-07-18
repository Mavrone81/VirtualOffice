"use server";

import { revalidatePath } from "next/cache";
import { InvoiceStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { recomputeEligibility } from "@/server/commission/eligibility";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

export async function markInvoicePaid(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, error: t("notFound") };

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: InvoiceStatus.Paid, paidDate: new Date(), paidMarkedById: session.user.id },
  });
  await recomputeEligibility(invoice.transactionId);
  await logAudit({ action: "invoice.marked_paid", entityType: "Invoice", entityId: invoiceId, actorUserId: session.user.id });

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
