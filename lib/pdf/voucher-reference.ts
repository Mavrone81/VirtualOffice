/** PV-<transactionCode>-<associateCode>-<seq>, e.g. PV-TXN-0412-EN0007-1.
 * `seq` (1, 2, …) is per (transaction, associate) — one per settling payout
 * (A-7, build-plan item A-7): an instalment sale paid across N payouts gets
 * N vouchers, a sale paid in one go gets exactly one, numbered 1. */
export function formatVoucherReference(transactionCode: string, associateCode: string, seq: number): string {
  return `PV-${transactionCode}-${associateCode}-${seq}`;
}

/** "Jane Tan" -> "JT"; drops anything that isn't a letter, caps at 4 initials. */
export function clientInitialsOf(clientName: string): string {
  return clientName
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .filter((ch) => /[A-Za-z一-鿿]/.test(ch))
    .slice(0, 4)
    .join("")
    .toUpperCase();
}
