import { Prisma, PayoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptPiiAudited } from "@/server/pii";

/**
 * Build the bank bulk-payout (GIRO) file for a month as CSV. Associate payout
 * only. Decrypts the bank account for the file (a C3-PII access — the caller
 * must be Admin/Accounts). The exact bank GIRO layout is TBC; this CSV is the
 * portable interim format.
 *
 * M5 — each payout is exported exactly once: the file takes only Approved payouts
 * with a positive total that are not yet in a bank-file batch, and stamps them
 * into a new BankFileBatch in the same transaction. Paid payouts are never
 * re-listed. Pass `batchId` to re-download an earlier batch (same rows, no new
 * selection). Returns the CSV plus the batch and payout ids for the audit trail.
 */
// CSV/spreadsheet formula injection (W4-GIRO): names, bank names and PayNow
// numbers are associate-supplied free text, and Accounts opens this file in a
// spreadsheet. A cell starting with = + - @ (or a tab/CR) would be evaluated as a
// formula, so it is neutralised with a leading apostrophe. A plain phone number
// such as "+65 9123 4567" is data, not a formula, and is left untouched so the
// bank upload still gets the real PayNow number.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_PHONE = /^\+\d[\d ]*$/;

export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (FORMULA_START.test(s) && !PLAIN_PHONE.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function buildBankFileCsv(
  month: string,
  actorUserId?: string | null,
  opts: { batchId?: string } = {},
): Promise<{ csv: string; batchId: string | null; payoutIds: string[]; total: string }> {
  let batchId: string | null = opts.batchId ?? null;

  if (!batchId) {
    batchId = await prisma.$transaction(async (db) => {
      const candidates = await db.monthlyPayout.findMany({
        where: { payoutMonth: month, payoutStatus: PayoutStatus.Approved, bankFileBatchId: null, totalPayable: { gt: 0 } },
        select: { id: true },
      });
      if (candidates.length === 0) return null;
      const batch = await db.bankFileBatch.create({ data: { payoutMonth: month, generatedById: actorUserId ?? null } });
      // Compare-and-swap: only payouts still unexported and Approved are stamped.
      await db.monthlyPayout.updateMany({
        where: { id: { in: candidates.map((c) => c.id) }, bankFileBatchId: null, payoutStatus: PayoutStatus.Approved },
        data: { bankFileBatchId: batch.id },
      });
      return batch.id;
    });
  }

  const payouts = batchId
    ? await prisma.monthlyPayout.findMany({
        where: { bankFileBatchId: batchId, payoutMonth: month },
        include: { associate: true },
        orderBy: [{ associateName: "asc" }, { seq: "asc" }],
      })
    : [];

  const header = ["AssociateCode", "Name", "Method", "PayNow/Account", "Bank", "Amount(SGD)", "Reference"];
  const rows = [header];

  for (const p of payouts) {
    let account = p.paynowNumber ?? "";
    if (p.paymentMethod === "BankTransfer" && p.bankAccountNumber) {
      account = (await decryptPiiAudited({
        blob: p.bankAccountNumber, field: "bankAccount",
        subjectType: "Associate", subjectId: p.associate.id, actorUserId,
      })) ?? "(decrypt-failed)";
    }
    rows.push([
      p.associate.associateCode,
      p.associateName,
      p.paymentMethod ?? "",
      account,
      p.bankName ?? "",
      p.totalPayable.toFixed(2),
      p.seq > 0 ? `Commission ${month} adj ${p.seq}` : `Commission ${month}`,
    ]);
  }

  const total = payouts.reduce((s, p) => s.add(p.totalPayable), new Prisma.Decimal(0));
  return {
    csv: rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
    batchId,
    payoutIds: payouts.map((p) => p.id),
    total: total.toFixed(2),
  };
}
