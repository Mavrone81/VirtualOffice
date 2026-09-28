"use server";

import { Prisma, QuotationStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { validate } from "@/lib/validate";
import { quotationSchema } from "@/lib/schemas";
import { canManageQuotation } from "@/lib/quotation-access";
import { logAudit } from "@/lib/audit";
import { resolveSaleLines } from "@/server/sales/actions";

/** A-17 §2: QUO-nnnn from its own sequence — never TXN-, a different record. */
async function nextQuotationCode(db: Prisma.TransactionClient | typeof prisma): Promise<string> {
  const rows = await db.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('quotation_code_seq')`;
  return `QUO-${String(Number(rows[0].nextval)).padStart(4, "0")}`;
}

export type QuotationLineSnapshot = { productCode: string; productName: string; amount: string; addOns: { comCode: string; label: string }[] };

/**
 * Issue a quotation (design note §1a/§3): server-priced exactly like a real
 * sale line (resolveSaleLines — same active-product filter, same rate
 * lookup), immutable once created, no approval, no client signature. Never
 * touches the commission engine or any money table.
 */
export async function createQuotation(input: {
  clientName: string; clientContact?: string; quoteDate: string; validUntil?: string;
  lines: { productId: string; lineSaleAmount: number; comCodeIds: string[] }[];
}): Promise<{ ok: boolean; error?: string; id?: string; quotationCode?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session?.user.associateId) return { ok: false, error: t("noAssociateProfile") };

  const v = validate(quotationSchema, input);
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;

  const { lineData, saleAmount } = await resolveSaleLines(validInput.lines);
  const lines: QuotationLineSnapshot[] = lineData.map((l) => ({
    productCode: l.productCode,
    productName: l.productName,
    amount: l.lineSaleAmount.toFixed(2),
    addOns: (l.selectedComCodes ?? []).map((c) => ({ comCode: c.comCode, label: c.label })),
  }));

  const created = await prisma.$transaction(async (db) => {
    const quotationCode = await nextQuotationCode(db);
    const q = await db.quotation.create({
      data: {
        quotationCode,
        associateId: session.user.associateId!,
        clientName: validInput.clientName.trim(),
        clientContact: validInput.clientContact?.trim() || null,
        quoteDate: new Date(validInput.quoteDate),
        validUntil: validInput.validUntil ? new Date(validInput.validUntil) : null,
        lines: lines as unknown as Prisma.InputJsonValue,
        total: saleAmount,
        status: QuotationStatus.Issued,
        createdById: session.user.id,
      },
      select: { id: true, quotationCode: true },
    });
    return q;
  });

  await logAudit({ action: "quotation.created", entityType: "Quotation", entityId: created.id, actorUserId: session.user.id, after: { quotationCode: created.quotationCode, total: saleAmount.toFixed(2) } });
  revalidatePath("/portal/agreements");
  revalidatePath("/admin/quotations");
  return { ok: true, id: created.id, quotationCode: created.quotationCode };
}

/**
 * Void a quotation (owner or admin, reason required). Issued -> Void only;
 * Converted quotations can't be voided (the deal they prefilled already
 * exists) — refused with alreadyProcessed, matching the app's convention.
 */
export async function voidQuotation(quotationId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session) return { ok: false, error: t("forbidden") };
  const trimmedReason = reason?.trim();
  if (!trimmedReason) return { ok: false, error: t("reasonRequired") };

  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { associateId: true, status: true } });
  if (!quotation) return { ok: false, error: t("notFound") };
  if (!canManageQuotation(quotation, { associateId: session.user.associateId, role: session.user.role })) {
    return { ok: false, error: t("forbidden") };
  }

  const result = await prisma.quotation.updateMany({
    where: { id: quotationId, status: QuotationStatus.Issued },
    data: { status: QuotationStatus.Void, voidedAt: new Date(), voidedById: session.user.id, voidReason: trimmedReason },
  });
  if (result.count === 0) return { ok: false, error: t("alreadyProcessed") };

  await logAudit({ action: "quotation.voided", entityType: "Quotation", entityId: quotationId, actorUserId: session.user.id, after: { reason: trimmedReason } });
  revalidatePath("/portal/agreements");
  revalidatePath("/admin/quotations");
  return { ok: true };
}
