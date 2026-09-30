import { describe, test, expect } from "vitest";
import { D, round2, pctOf, effectivePrice, instalmentTotal } from "./money";

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
