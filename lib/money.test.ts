import { describe, test, expect } from "vitest";
import { D, round2, pctOf, effectivePrice, instalmentTotal, formatPercent } from "./money";

// Every expected figure below is a hand-derived literal, computed
// independently of the implementation — never asserted against whatever
// the function under test happens to return.
// Values are deliberately non-round and include classic float traps: money
// must never round-trip through JS number in a way that loses precision.

describe("D / round2 — Decimal, never a float", () => {
  test("adding via D() avoids the classic 0.1 + 0.2 float trap", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // sanity: native JS floats really do break here
    expect(D(0.1).add(D(0.2)).toString()).toBe("0.3");
  });

  test("round2 half-up: a value ending exactly .5 at the 3rd decimal rounds UP", () => {
    // 0.125 is exactly halfway between 0.12 and 0.13 — the rounding MODE is
    // the entire content of this test (ROUND_HALF_DOWN would give 0.12).
    expect(round2("0.125").toFixed(2)).toBe("0.13");
  });

  test("round2 on a non-round 4dp value", () => {
    expect(round2("19.995").toFixed(2)).toBe("20.00");
  });
});

describe("pctOf — % -> $, the figure the portal must never compute itself", () => {
  test("19.99 at 33.33% — hand-computed: 19.99 * 33.33 / 100 = 6.662667 -> 6.66", () => {
    expect(pctOf("19.99", "33.33").toFixed(2)).toBe("6.66");
  });

  test("100.10 at 12.5% — hand-computed: 100.10 * 12.5 / 100 = 12.5125 -> 12.51", () => {
    expect(pctOf("100.10", "12.5").toFixed(2)).toBe("12.51");
  });
});

describe("effectivePrice — discounted ?? listed (a selection, nothing to round)", () => {
  test("no discount set (null): the listed price, at full precision", () => {
    expect(effectivePrice("19.99", null).toFixed(2)).toBe("19.99");
  });

  test("no discount set (undefined): same as null", () => {
    expect(effectivePrice("19.99", undefined).toFixed(2)).toBe("19.99");
  });

  test("a discount set: the discounted price wins, not the listed one", () => {
    expect(effectivePrice("199.99", "149.99").toFixed(2)).toBe("149.99");
  });
});

describe("instalmentTotal — soft admin hint (no DB constraint behind it)", () => {
  test("bookingFee 0.2 + monthly 0.1 x 3 months — the exact 0.1+0.2-style float trap, scaled by a multiply", () => {
    // Floats: 0.2 + (0.1 * 3) = 0.2 + 0.30000000000000004 = 0.5000000000000001.
    // Decimal must land on exactly 0.50.
    expect(instalmentTotal("0.2", "0.1", 3).toFixed(2)).toBe("0.50");
  });

  test("realistic 24-month plan, non-round monthly amount: 500.00 + 199.99 x 24 = 5299.76", () => {
    expect(instalmentTotal("500.00", "199.99", 24).toFixed(2)).toBe("5299.76");
  });

  test("rounding happens ONCE, on the final summed total — not per term", () => {
    // monthly (33.335) has a 3rd decimal a real Decimal(14,2) column could
    // never store; used here purely to prove the function's OWN rounding
    // step actually fires on the sum, at the point documented in its own
    // comment, rather than silently truncating or rounding an intermediate
    // term. 0 + 33.335 x 1 = 33.335 -> half-up -> 33.34.
    expect(instalmentTotal("0", "33.335", 1).toFixed(2)).toBe("33.34");
  });

  test("months=0 (degenerate, e.g. a plan with no term yet): just the booking fee", () => {
    expect(instalmentTotal("250.00", "80.00", 0).toFixed(2)).toBe("250.00");
  });
});

describe("formatPercent — 2dp display, ROUND_HALF_UP, Decimal not Number", () => {
  test("12.5000 -> 12.50% (plain truncation to 2dp, no rounding decision made)", () => {
    expect(formatPercent("12.5000")).toBe("12.50%");
  });

  // 12.5000 and 7.1250 are both EXACTLY representable in IEEE-754 binary, so
  // a buggy Number(v).toFixed(2) would pass these two by coincidence — they
  // prove 2dp truncation, not the rounding MODE. 7.1250 is the first one that
  // actually pins half-up: half-even would give 7.12, half-up gives 7.13.
  test("7.1250 -> 7.13% (half-up; half-even would give 7.12)", () => {
    expect(formatPercent("7.1250")).toBe("7.13%");
  });

  // 1.005 and 2.675 are NOT exactly representable in binary floating point —
  // 1.005 is actually stored as ~1.00499999999999989..., so Number(1.005)
  // .toFixed(2) gives "1.00", not "1.01". These two cases fail under a float
  // implementation specifically (not just an unproven rounding mode); they
  // only pass through Prisma.Decimal (decimal.js), which parses the DECIMAL
  // STRING exactly rather than coercing through a binary float first.
  test("1.0050 -> 1.01% (fails under Number().toFixed — binary float stores ~1.00499999...)", () => {
    expect(formatPercent("1.0050")).toBe("1.01%");
  });

  test("2.6750 -> 2.68% (same float trap: binary float stores ~2.67499999...)", () => {
    expect(formatPercent("2.6750")).toBe("2.68%");
  });

  test("0 -> 0.00%", () => {
    expect(formatPercent("0")).toBe("0.00%");
  });

  test("100 -> 100.00%", () => {
    expect(formatPercent("100")).toBe("100.00%");
  });
});
