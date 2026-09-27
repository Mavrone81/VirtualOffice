"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { InvoiceStatus, InvoicePaymentMethod, Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { canManageSignedInvoice } from "@/lib/invoice-access";
import { logAudit } from "@/lib/audit";
import { putObject } from "@/lib/storage";
import { assertUpload } from "@/lib/file-type";
import { recomputeEligibilityTx } from "@/server/commission/eligibility";
import { auditRunResult, COMMISSION_TX_OPTIONS } from "@/server/commission/run";
import { recomputeAmountCollected } from "@/server/transactions/amount-collected";

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

class AlreadyProcessed extends Error {}

/**
 * A-0/F24/B-7: the shared body of every mark-paid/unpaid action. ONE
 * transaction, in the team's lock order (sale, then whatever the CAS touches):
 *   1. FOR UPDATE on the sales_transactions row FIRST — before the CAS, so a
 *      concurrent mark on the same transaction serialises here rather than
 *      racing amountCollected's recompute (re-entrant: runCommissionTx's own
 *      lock on the same row inside recomputeEligibilityTx is a no-op re-take).
 *   2. The CAS update (`applyCas`) on the invoice/installment row, matched on
 *      its expected prior state. count !== 1 means it wasn't in that state —
 *      already processed (a double-click), not an error to retry.
 *   3. recomputeAmountCollected — derived from source rows, clamped, no
 *      increments, so it self-heals.
 *   4. recomputeEligibilityTx — eligibility + the ledger recompute, in the
 *      same transaction, so they can never disagree with what was just paid.
 * On a lock-wait timeout (P2028) NOTHING is saved (the whole transaction rolls
 * back) — the caller reports it as "system busy, try again", never as a
 * partial success.
 *
 * M1 (Architect money review): if recomputeAmountCollected finds the raw sum
 * over the sale amount (a duplicate invoice, a schedule bug), the clamp still
 * caps the stored value, but this audits `transaction.over_collected` (after
 * commit, same as every other audit here) and returns `overCollected: true`
 * so the caller can surface it — never silently swallowed.
 */
async function markPaidOrUnpaid(
  transactionId: string,
  actorUserId: string,
  applyCas: (db: Prisma.TransactionClient) => Promise<{ count: number }>,
): Promise<
  | { ok: true; run: Awaited<ReturnType<typeof recomputeEligibilityTx>>["run"]; overCollected: boolean }
  | { ok: false; error: "alreadyProcessed" | "recomputeBusy" }
> {
  try {
    const result = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM sales_transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
      const res = await applyCas(db);
      if (res.count !== 1) throw new AlreadyProcessed();
      const collected = await recomputeAmountCollected(db, transactionId);
      const elig = await recomputeEligibilityTx(db, transactionId);
      return { ...elig, overCollected: collected.overCollected };
    }, COMMISSION_TX_OPTIONS);
    if (result.overCollected) {
      await logAudit({ action: "transaction.over_collected", entityType: "SalesTransaction", entityId: transactionId, actorUserId, after: result.overCollected });
    }
    return { ok: true, run: result.run, overCollected: !!result.overCollected };
  } catch (e) {
    if (e instanceof AlreadyProcessed) return { ok: false, error: "alreadyProcessed" };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") return { ok: false, error: "recomputeBusy" };
    throw e;
  }
}

export async function markInvoicePaid(
  invoiceId: string,
  payment?: { method: InvoicePaymentMethod; reference?: string },
): Promise<{ ok: boolean; error?: string; overCollected?: boolean }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, error: t("notFound") };

  const result = await markPaidOrUnpaid(invoice.transactionId, session.user.id, (db) =>
    db.invoice.updateMany({
      where: { id: invoiceId, status: InvoiceStatus.Outstanding },
      data: {
        status: InvoiceStatus.Paid,
        paidDate: new Date(),
        paidMarkedById: session.user.id,
        paidMethod: payment?.method ?? null,
        paidReference: payment?.reference?.trim() || null,
      },
    }),
  );
  if (!result.ok) return { ok: false, error: t(result.error) };

  await auditRunResult(invoice.transactionId, result.run);
  await logAudit({ action: "invoice.marked_paid", entityType: "Invoice", entityId: invoiceId, actorUserId: session.user.id, after: { method: payment?.method ?? null, reference: payment?.reference?.trim() || null } });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return result.overCollected ? { ok: true, overCollected: true } : { ok: true };
}

export async function markInstallmentPaid(scheduleId: string): Promise<{ ok: boolean; error?: string; overCollected?: boolean }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const entry = await prisma.installmentSchedule.findUnique({
    where: { id: scheduleId },
    include: { plan: true },
  });
  if (!entry) return { ok: false, error: t("notFound") };

  const result = await markPaidOrUnpaid(entry.plan.transactionId, session.user.id, (db) =>
    db.installmentSchedule.updateMany({ where: { id: scheduleId, paid: false }, data: { paid: true, paidDate: new Date() } }),
  );
  if (!result.ok) return { ok: false, error: t(result.error) };

  await auditRunResult(entry.plan.transactionId, result.run);
  await logAudit({ action: "installment.marked_paid", entityType: "InstallmentSchedule", entityId: scheduleId, actorUserId: session.user.id });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return result.overCollected ? { ok: true, overCollected: true } : { ok: true };
}

/** Revert a direct invoice to Unpaid (correction); recomputes commission eligibility. */
export async function markInvoiceUnpaid(invoiceId: string): Promise<{ ok: boolean; error?: string; overCollected?: boolean }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, error: t("notFound") };

  const result = await markPaidOrUnpaid(invoice.transactionId, session.user.id, (db) =>
    db.invoice.updateMany({
      where: { id: invoiceId, status: InvoiceStatus.Paid },
      data: { status: InvoiceStatus.Outstanding, paidDate: null, paidMarkedById: null, paidMethod: null, paidReference: null },
    }),
  );
  if (!result.ok) return { ok: false, error: t(result.error) };

  await auditRunResult(invoice.transactionId, result.run);
  await logAudit({ action: "invoice.marked_unpaid", entityType: "Invoice", entityId: invoiceId, actorUserId: session.user.id });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return result.overCollected ? { ok: true, overCollected: true } : { ok: true };
}

/** Revert an installment to Unpaid (correction); recomputes commission eligibility. */
export async function markInstallmentUnpaid(scheduleId: string): Promise<{ ok: boolean; error?: string; overCollected?: boolean }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const entry = await prisma.installmentSchedule.findUnique({ where: { id: scheduleId }, include: { plan: true } });
  if (!entry) return { ok: false, error: t("notFound") };

  const result = await markPaidOrUnpaid(entry.plan.transactionId, session.user.id, (db) =>
    db.installmentSchedule.updateMany({ where: { id: scheduleId, paid: true }, data: { paid: false, paidDate: null } }),
  );
  if (!result.ok) return { ok: false, error: t(result.error) };

  await auditRunResult(entry.plan.transactionId, result.run);
  await logAudit({ action: "installment.marked_unpaid", entityType: "InstallmentSchedule", entityId: scheduleId, actorUserId: session.user.id });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return result.overCollected ? { ok: true, overCollected: true } : { ok: true };
}
