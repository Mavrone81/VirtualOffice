// Amount-in-words for the Storage of Pets Ashes Agreement (Sep 2026):
// "SINGAPORE DOLLARS <words> (S$<n>)". Pure so it unit-tests without a DB.

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALE = ["", " Thousand", " Million", " Billion"];

function threeDigits(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const t = TENS[Math.floor(rest / 10)];
      const o = ONES[rest % 10];
      parts.push(o ? `${t}-${o}` : t);
    }
  }
  return parts.join(" and ");
}

/** Whole-number → English words ("One Thousand Two Hundred and Thirty-Four"). */
export function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`numberToWords: invalid ${n}`);
  n = Math.floor(n);
  if (n === 0) return "Zero";
  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const g = n % 1000;
    if (g) groups.unshift(threeDigits(g) + SCALE[scale]);
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(" ");
}

/** Money (dollars.cents) → agreement wording, e.g.
 *  1250.50 → "One Thousand Two Hundred and Fifty and Cents Fifty Only". */
export function amountToWords(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value) || value < 0) throw new Error(`amountToWords: invalid ${amount}`);
  const dollars = Math.floor(value);
  const cents = Math.round((value - dollars) * 100);
  const d = numberToWords(dollars);
  return cents > 0 ? `${d} and Cents ${numberToWords(cents)} Only` : `${d} Only`;
}
