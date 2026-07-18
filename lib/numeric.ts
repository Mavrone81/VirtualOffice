/**
 * Global Rule 1 (16-Jul): every value field accepts a number to at most 2
 * decimal places. This is the shared keystroke sanitizer — it keeps input
 * numeric and caps the fraction at 2 dp, while allowing a trailing dot so the
 * user can still be mid-typing ("12." → "12.").
 */
export function sanitizeAmountInput(raw: string): string {
  // keep digits and dots only
  let s = raw.replace(/[^\d.]/g, "");
  // collapse to a single dot (keep the first)
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  const [intPart, decPart] = s.split(".");
  return decPart !== undefined ? `${intPart}.${decPart.slice(0, 2)}` : s;
}
