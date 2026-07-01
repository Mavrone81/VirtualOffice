import { PayoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptPII } from "@/lib/crypto";

/**
 * Build the bank bulk-payout (GIRO) file for a month as CSV. Associate payout
 * only. Decrypts the bank account for the file (a C3-PII access — the caller
 * must be Admin/Accounts). The exact bank GIRO layout is TBC; this CSV is the
 * portable interim format.
 */
export async function buildBankFileCsv(month: string): Promise<string> {
  const payouts = await prisma.monthlyPayout.findMany({
    where: { payoutMonth: month, payoutStatus: { in: [PayoutStatus.Approved, PayoutStatus.Paid] } },
    include: { associate: true },
    orderBy: { associateName: "asc" },
  });

  const header = ["AssociateCode", "Name", "Method", "PayNow/Account", "Bank", "Amount(SGD)", "Reference"];
  const rows = [header];

  for (const p of payouts) {
    let account = p.paynowNumber ?? "";
    if (p.paymentMethod === "BankTransfer" && p.bankAccountNumber) {
      try {
        account = decryptPII(p.bankAccountNumber);
      } catch {
        account = "(decrypt-failed)";
      }
    }
    rows.push([
      p.associate.associateCode,
      p.associateName,
      p.paymentMethod ?? "",
      account,
      p.bankName ?? "",
      p.totalPayable.toFixed(2),
      `Commission ${month}`,
    ]);
  }

  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
}
