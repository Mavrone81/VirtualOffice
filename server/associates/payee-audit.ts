import { decryptPiiRaw, maskAccount } from "@/lib/crypto";

// Audit reliability (reviews/audit-reliability.md, Tier A "payee details"): every
// change to who gets paid, and where, is recorded — masked (last 4) only. The stored bank account is decrypted
// here solely to mask it; the plaintext is never logged, returned or stored.
export type PayeeFields = {
  paymentMethod: string | null;
  bankName: string | null;
  paynowNumber: string | null;
  bankAccountNumber: string | null; // ciphertext, as stored
};

export function maskedPayee(p: PayeeFields): { paymentMethod: string | null; bankName: string | null; paynow: string | null; bankAccount: string | null } {
  let bankAccount: string | null = null;
  if (p.bankAccountNumber) {
    try {
      bankAccount = maskAccount(decryptPiiRaw(p.bankAccountNumber));
    } catch {
      bankAccount = "(unreadable)";
    }
  }
  return { paymentMethod: p.paymentMethod, bankName: p.bankName, paynow: p.paynowNumber ? maskAccount(p.paynowNumber) : null, bankAccount };
}

export function payeeChanged(a: PayeeFields, b: PayeeFields): boolean {
  const ma = maskedPayee(a), mb = maskedPayee(b);
  return ma.paymentMethod !== mb.paymentMethod || ma.bankName !== mb.bankName || a.paynowNumber !== b.paynowNumber || a.bankAccountNumber !== b.bankAccountNumber;
}
