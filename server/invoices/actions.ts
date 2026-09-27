"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { InvoiceStatus, InvoicePaymentMethod, Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole, isFullAdmin } from "@/lib/rbac";
import { canManageSignedInvoice } from "@/lib/invoice-access";
import { logAudit } from "@/lib/audit";
import { putObject, deleteObject } from "@/lib/storage";
import { assertUpload } from "@/lib/file-type";
import { recomputeEligibilityTx } from "@/server/commission/eligibility";
import { auditRunResult, COMMISSION_TX_OPTIONS } from "@/server/commission/run";
import { recomputeAmountCollected } from "@/server/transactions/amount-collected";
import { hasLinkedSettledLine, hasUnreconciledLegacyPayout } from "@/server/invoices/settled-check";

const MAX_SIGNED_BYTES = 15_000_000;
// K5 (DevSecOps): capped to the server action body limit (next.config.ts
// serverActions.bodySizeLimit: "10mb"), not the 15 MB used for other uploads
// that go through a route handler instead — a File this size or larger never
// reaches this action in the first place, so a higher cap here would be
// dead code, not a real allowance.
const MAX_ACK_BYTES = 10_000_000;
const ACK_EXT: Record<"pdf" | "png" | "jpeg", string> = { pdf: "pdf", png: "png", jpeg: "jpg" };

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

/** B-7: un-mark-paid is Business Admin only — Accounts can mark paid but not unmark. */
async function requireFullAdmin() {
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) return null;
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

/**
 * B-7: the payment acknowledgement required to mark an invoice/installment
 * Paid. Same SEC-11 posture as uploadSignedInvoice — magic-byte sniffed, never
 * trusting the browser's declared type — widened to PDF/JPG/PNG per the spec.
 * `prefix` scopes the storage key to the invoice/schedule id (never a raw key
 * in a URL — ADR-0001; the serving route looks this column up by record id).
 */
async function storePaymentAck(
  prefix: string,
  file: File,
  t: (key: string) => string,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  if (!file || file.size === 0) return { ok: false, error: t("fileRequired") };
  if (file.size > MAX_ACK_BYTES) return { ok: false, error: t("fileTooLarge") };

  const bytes = new Uint8Array(await file.arrayBuffer());
  let kind: "pdf" | "png" | "jpeg";
  try {
    kind = assertUpload(bytes, ["pdf", "png", "jpeg"]);
  } catch {
    return { ok: false, error: t("invalidFileType") };
  }

  const key = `payment-acks/${prefix}/${randomUUID()}.${ACK_EXT[kind]}`;
  await putObject(key, Buffer.from(bytes));
  return { ok: true, key };
}
// K1 (DevSecOps, DevLead retracted the earlier "don't delete" concern): the
// upload above happens before the transaction opens, so a refused mark
// (alreadyProcessed, recomputeBusy, a Blocked guard) leaves the file it just
// stored orphaned. Safe to delete on that path — every call mints its own
// fresh randomUUID() key, so a refused call's key was never written to any
// row and can't be a file a different, successful call is now pointing at.
// deleteObject (lib/storage.ts) already swallows a missing-file error itself,
// so callers just await it — best-effort by construction.

class AlreadyProcessed extends Error {}
class Blocked extends Error {
  constructor(public reasonKey: string) {
    super(reasonKey);
  }
}

/**
 * B-7: refuse to un-mark when the transaction has any commission line
 * already settled in an Approved OR Paid payout (M5 payoutId ->
 * payout.payoutStatus). Approved, not just Paid: runCommissionTx treats any
 * non-Pending payout as settled and keeps its lines untouched, so if the
 * check only excluded Paid, an Approved payout could go Paid later while
 * the invoice sits unmarked — commission paid for a sale that's now unpaid.
 * X1 (Architect): also refused for an unreconciled legacy (pre-M5, unlinked)
 * payout — see settled-check.ts's doc comment for why.
 *
 * Closed against the interleaving too (DevLead): setPayoutStatus now locks
 * every transaction this payout's lines belong to, in the same order
 * (sale -> ledger -> payout), before its own CAS — see
 * server/payouts/actions.ts. That serialises this guard against a
 * concurrent Approved/Paid transition rather than racing it.
 *
 * The two predicates live in settled-check.ts (extracted, same behavior) so
 * the UI can check "is this settled?" for many transactions at once without
 * duplicating the rule (ADR-0001 §7) — this function keeps the specific
 * error-key distinction that read-only check doesn't need.
 */
async function refuseIfSettled(db: Prisma.TransactionClient, transactionId: string): Promise<string | null> {
  if (await hasLinkedSettledLine(db, transactionId)) return "payoutAlreadyApprovedOrPaid";
  if (await hasUnreconciledLegacyPayout(db, transactionId)) return "legacyReconciliationPending";
  return null;
}

/**
 * A-0/F24/B-7: the shared body of every mark-paid/unpaid action. ONE
 * transaction, in the team's lock order (sale, then whatever the CAS touches):
 *   1. FOR UPDATE on the sales_transactions row FIRST — before the guard/CAS,
 *      so a concurrent mark on the same transaction serialises here rather
 *      than racing amountCollected's recompute (re-entrant: runCommissionTx's
 *      own lock on the same row inside recomputeEligibilityTx is a no-op
 *      re-take).
 *   2. `guard` (B-7 unmark only) — a business-rule refusal checked under the
 *      same lock; a `Blocked` result never reaches the CAS.
 *   3. The CAS update (`applyCas`) on the invoice/installment row, matched on
 *      its expected prior state. count !== 1 means it wasn't in that state —
 *      already processed (a double-click), not an error to retry.
 *   4. recomputeAmountCollected — derived from source rows, clamped, no
 *      increments, so it self-heals.
 *   5. recomputeEligibilityTx — eligibility + the ledger recompute, in the
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
  opts?: { guard?: (db: Prisma.TransactionClient) => Promise<string | null> },
): Promise<
  | { ok: true; run: Awaited<ReturnType<typeof recomputeEligibilityTx>>["run"]; overCollected: boolean }
  | { ok: false; error: "alreadyProcessed" | "recomputeBusy" | string }
> {
  try {
    const result = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM sales_transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
      if (opts?.guard) {
        const blocked = await opts.guard(db);
        if (blocked) throw new Blocked(blocked);
      }
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
    if (e instanceof Blocked) return { ok: false, error: e.reasonKey };
    if (e instanceof AlreadyProcessed) return { ok: false, error: "alreadyProcessed" };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") return { ok: false, error: "recomputeBusy" };
    throw e;
  }
}

export async function markInvoicePaid(
  invoiceId: string,
  ackFile: File,
  payment?: { method: InvoicePaymentMethod; reference?: string },
): Promise<{ ok: boolean; error?: string; overCollected?: boolean }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, error: t("notFound") };

  const ack = await storePaymentAck(invoiceId, ackFile, t);
  if (!ack.ok) return ack;

  // DevSecOps: delete the just-stored ack on ANY failure path — a handled
  // refusal (below) or an unexpected throw — never just the former.
  let result: Awaited<ReturnType<typeof markPaidOrUnpaid>>;
  try {
    result = await markPaidOrUnpaid(invoice.transactionId, session.user.id, (db) =>
      db.invoice.updateMany({
        where: { id: invoiceId, status: InvoiceStatus.Outstanding },
        data: {
          status: InvoiceStatus.Paid,
          paidDate: new Date(),
          paidMarkedById: session.user.id,
          paidMethod: payment?.method ?? null,
          paidReference: payment?.reference?.trim() || null,
          paymentAckFileKey: ack.key,
        },
      }),
    );
  } catch (e) {
    await deleteObject(ack.key);
    throw e;
  }
  if (!result.ok) {
    await deleteObject(ack.key);
    return { ok: false, error: t(result.error) };
  }

  await auditRunResult(invoice.transactionId, result.run);
  await logAudit({ action: "invoice.marked_paid", entityType: "Invoice", entityId: invoiceId, actorUserId: session.user.id, after: { method: payment?.method ?? null, reference: payment?.reference?.trim() || null, ackFileKey: ack.key } });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return result.overCollected ? { ok: true, overCollected: true } : { ok: true };
}

export async function markInstallmentPaid(
  scheduleId: string,
  ackFile: File,
  payment?: { method: InvoicePaymentMethod; reference?: string },
): Promise<{ ok: boolean; error?: string; overCollected?: boolean }> {
  const t = await getTranslations("errors");
  const session = await requireAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const entry = await prisma.installmentSchedule.findUnique({
    where: { id: scheduleId },
    include: { plan: true },
  });
  if (!entry) return { ok: false, error: t("notFound") };

  const ack = await storePaymentAck(scheduleId, ackFile, t);
  if (!ack.ok) return ack;

  let result: Awaited<ReturnType<typeof markPaidOrUnpaid>>;
  try {
    result = await markPaidOrUnpaid(entry.plan.transactionId, session.user.id, (db) =>
      db.installmentSchedule.updateMany({
        where: { id: scheduleId, paid: false },
        data: {
          paid: true,
          paidDate: new Date(),
          paymentAckFileKey: ack.key,
          paidMethod: payment?.method ?? null,
          paidReference: payment?.reference?.trim() || null,
        },
      }),
    );
  } catch (e) {
    await deleteObject(ack.key);
    throw e;
  }
  if (!result.ok) {
    await deleteObject(ack.key);
    return { ok: false, error: t(result.error) };
  }

  await auditRunResult(entry.plan.transactionId, result.run);
  await logAudit({
    action: "installment.marked_paid", entityType: "InstallmentSchedule", entityId: scheduleId, actorUserId: session.user.id,
    after: { method: payment?.method ?? null, reference: payment?.reference?.trim() || null, ackFileKey: ack.key },
  });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return result.overCollected ? { ok: true, overCollected: true } : { ok: true };
}

/**
 * Revert a direct invoice to Unpaid (correction). Business Admin only,
 * requires a reason (audited), refused if the transaction's commission is
 * already settled in an Approved or Paid payout (or an unreconciled legacy
 * one — see refuseIfSettled's X1 fix).
 */
export async function markInvoiceUnpaid(invoiceId: string, reason: string): Promise<{ ok: boolean; error?: string; overCollected?: boolean }> {
  const t = await getTranslations("errors");
  const session = await requireFullAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  const trimmedReason = reason?.trim();
  if (!trimmedReason) return { ok: false, error: t("reasonRequired") };

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return { ok: false, error: t("notFound") };

  // DevLead follow-up: read the about-to-be-cleared fields INSIDE the
  // transaction, under the sale lock, right before the CAS — not from the
  // `invoice` read above, which happens before the lock and could be stale
  // if a concurrent unmark->re-mark landed in between.
  const captured: { cleared?: { paidMethod: InvoicePaymentMethod | null; paidReference: string | null; paymentAckFileKey: string | null } } = {};
  const result = await markPaidOrUnpaid(
    invoice.transactionId,
    session.user.id,
    async (db) => {
      captured.cleared = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { paidMethod: true, paidReference: true, paymentAckFileKey: true } });
      return db.invoice.updateMany({
        where: { id: invoiceId, status: InvoiceStatus.Paid },
        data: { status: InvoiceStatus.Outstanding, paidDate: null, paidMarkedById: null, paidMethod: null, paidReference: null, paymentAckFileKey: null },
      });
    },
    { guard: (db) => refuseIfSettled(db, invoice.transactionId) },
  );
  if (!result.ok) return { ok: false, error: t(result.error) };

  await auditRunResult(invoice.transactionId, result.run);
  // DevLead: the ack/method/reference being cleared are recoverable from this
  // audit's `before` — otherwise the first ack is lost with no trace once a
  // later mark overwrites the key.
  await logAudit({
    action: "invoice.marked_unpaid", entityType: "Invoice", entityId: invoiceId, actorUserId: session.user.id,
    before: { method: captured.cleared?.paidMethod ?? null, reference: captured.cleared?.paidReference ?? null, ackFileKey: captured.cleared?.paymentAckFileKey ?? null },
    after: { reason: trimmedReason },
  });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return result.overCollected ? { ok: true, overCollected: true } : { ok: true };
}

/**
 * Revert an installment to Unpaid (correction). Business Admin only,
 * requires a reason (audited), refused if the transaction's commission is
 * already settled in an Approved or Paid payout (or an unreconciled legacy
 * one — see refuseIfSettled's X1 fix).
 */
export async function markInstallmentUnpaid(scheduleId: string, reason: string): Promise<{ ok: boolean; error?: string; overCollected?: boolean }> {
  const t = await getTranslations("errors");
  const session = await requireFullAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  const trimmedReason = reason?.trim();
  if (!trimmedReason) return { ok: false, error: t("reasonRequired") };

  const entry = await prisma.installmentSchedule.findUnique({ where: { id: scheduleId }, include: { plan: true } });
  if (!entry) return { ok: false, error: t("notFound") };

  // DevLead follow-up: same as markInvoiceUnpaid — read the fields being
  // cleared under the sale lock, right before the CAS.
  const captured: { cleared?: { paidMethod: InvoicePaymentMethod | null; paidReference: string | null; paymentAckFileKey: string | null } } = {};
  const result = await markPaidOrUnpaid(
    entry.plan.transactionId,
    session.user.id,
    async (db) => {
      captured.cleared = await db.installmentSchedule.findUniqueOrThrow({ where: { id: scheduleId }, select: { paidMethod: true, paidReference: true, paymentAckFileKey: true } });
      return db.installmentSchedule.updateMany({
        where: { id: scheduleId, paid: true },
        data: { paid: false, paidDate: null, paidMethod: null, paidReference: null, paymentAckFileKey: null },
      });
    },
    { guard: (db) => refuseIfSettled(db, entry.plan.transactionId) },
  );
  if (!result.ok) return { ok: false, error: t(result.error) };

  await auditRunResult(entry.plan.transactionId, result.run);
  await logAudit({
    action: "installment.marked_unpaid", entityType: "InstallmentSchedule", entityId: scheduleId, actorUserId: session.user.id,
    before: { method: captured.cleared?.paidMethod ?? null, reference: captured.cleared?.paidReference ?? null, ackFileKey: captured.cleared?.paymentAckFileKey ?? null },
    after: { reason: trimmedReason },
  });

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/payouts");
  return result.overCollected ? { ok: true, overCollected: true } : { ok: true };
}
