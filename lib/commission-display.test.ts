import { describe, test, expect } from "vitest";
import { hasCommission, commissionDisplay } from "./commission-display";

// hasCommission/commissionDisplay compare with Prisma.Decimal's own
// `.isZero()` (via money.ts's D()), never a JS truthiness check on the raw
// string — "0" and "0.0000" are both non-empty strings, so `if (raw)` would
// be TRUE for them (the exact trap this suite exists to catch), and
// `Number("0.0000")` is 0 but a naive `=== "0"` string compare would miss
// "0.0000"/"0.00" entirely. Every hide-case below uses a different zero
// spelling for exactly that reason.

describe("hasCommission / commissionDisplay — hide null or zero, show anything real", () => {
  test("Percentage, null — never configured — hidden", () => {
    expect(hasCommission("Percentage", null, null)).toBe(false);
    expect(commissionDisplay("Percentage", null, null)).toBeNull();
  });

  test('Percentage, "0" — zero by design — hidden (bare "0", not 0.0000)', () => {
    expect(hasCommission("Percentage", "0", null)).toBe(false);
    expect(commissionDisplay("Percentage", "0", null)).toBeNull();
  });

  test('Percentage, "0.0000" — the DB\'s own stored precision — hidden', () => {
    expect(hasCommission("Percentage", "0.0000", null)).toBe(false);
    expect(commissionDisplay("Percentage", "0.0000", null)).toBeNull();
  });

  test("Fixed, null — never configured — hidden", () => {
    expect(hasCommission("Fixed", null, null)).toBe(false);
    expect(commissionDisplay("Fixed", null, null)).toBeNull();
  });

  test('Fixed, "0.00" — zero by design — hidden', () => {
    expect(hasCommission("Fixed", null, "0.00")).toBe(false);
    expect(commissionDisplay("Fixed", null, "0.00")).toBeNull();
  });

  // The two cases below are the control for the five above: if hasCommission
  // were hardcoded to always return false, every hide-case would pass
  // vacuously. A real non-zero value for EACH type must come out visible.
  test("Percentage, a real value — shown, formatted at 2dp", () => {
    expect(hasCommission("Percentage", "12.5000", null)).toBe(true);
    expect(commissionDisplay("Percentage", "12.5000", null)).toBe("12.50%");
  });

  test("Fixed, a real value — shown, as money", () => {
    expect(hasCommission("Fixed", null, "500.00")).toBe(true);
    expect(commissionDisplay("Fixed", null, "500.00")).toBe("S$500.00");
  });
});
