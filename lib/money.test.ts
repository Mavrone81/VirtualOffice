import { describe, test, expect } from "vitest";
import { D, round2, pctOf, effectivePrice, closingPrice, instalmentTotal, deriveInstalmentSchedule, formatPercent, formatByValueType, formatSGD } from "./money";

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

describe("closingPrice — explicit per-product basis, NOT auto-preferring a discount", () => {
  test("basis ListedPrice: the listed price, even though a discount is set (the discount is NOT auto-preferred, unlike effectivePrice)", () => {
    expect(closingPrice("199.99", "149.99", "ListedPrice").toFixed(2)).toBe("199.99");
  });

  test("basis ListedPrice, no discount at all: the listed price", () => {
    expect(closingPrice("19.99", null, "ListedPrice").toFixed(2)).toBe("19.99");
  });

  test("basis DiscountedPrice, a discount set: the discounted price", () => {
    expect(closingPrice("199.99", "149.99", "DiscountedPrice").toFixed(2)).toBe("149.99");
  });

  test("basis DiscountedPrice but discounted is null: falls back to listed, defensively — the server rejects this combination at write time (lib/schemas.ts pricingRefine), so this proves the DEFENSIVE path, not a reachable one", () => {
    expect(closingPrice("199.99", null, "DiscountedPrice").toFixed(2)).toBe("199.99");
  });

  test("basis DiscountedPrice but discounted is undefined: same defensive fallback", () => {
    expect(closingPrice("199.99", undefined, "DiscountedPrice").toFixed(2)).toBe("199.99");
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

describe("formatByValueType — render by the field's OWN type, never assume Percentage", () => {
  test("Percentage case: formatted as a percentage", () => {
    expect(formatByValueType("12.5000", "Percentage")).toBe("12.50%");
  });

  test("Absolute case: formatted as money, not a percentage", () => {
    expect(formatByValueType("250.00", "Absolute")).toBe("S$250.00");
  });

  // The control: the exact bug this function exists to prevent is an
  // Absolute dollar figure printed with a trailing "%" (formatPercent run on
  // a $ value regardless of type). A real Absolute value must never contain
  // "%" anywhere in its rendered output.
  test("CONTROL — an Absolute value's rendered string never contains a % sign", () => {
    const rendered = formatByValueType("250.00", "Absolute");
    expect(rendered).not.toContain("%");
    expect(rendered).toBe(formatSGD("250.00")); // same as calling the money formatter directly
  });
});

describe("deriveInstalmentSchedule — property-based: the schedule ALWAYS sums to exactly (price − fee)", () => {
  // Deterministic PRNG (mulberry32), not Math.random() — generated, not
  // hand-picked, but reproducible on every run; a flaky property test that
  // occasionally can't be reproduced would be worse than no property test.
  function mulberry32(seed: number): () => number {
    let s = seed;
    return () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CASES = 2000;
  const rand = mulberry32(0xc0ffee);
  // price up to $100,000.00, fee anywhere from 0 up to AND INCLUDING price
  // (fee == price is a valid, deliberately-covered corner — see below),
  // months anywhere in the REAL policy range (owner's ruling, 2026-10-09
  // addendum: 1..72, six years — raised from an unmade question, replacing
  // the 1200-month sanity bound this sweep used to cover). AD independently
  // property-checked the same invariant across 144,504 (price, months) pairs
  // over this exact range (price 0.01..20,000, every term 1..72) before
  // this was built, specifically so the design's survival past the old
  // 24-month ceiling wasn't merely hoped for.
  const generated: { price: string; fee: string; months: number }[] = [];
  for (let i = 0; i < CASES; i++) {
    const priceCents = 1 + Math.floor(rand() * 10_000_000);
    const feeCents = Math.floor(rand() * (priceCents + 1));
    const months = 1 + Math.floor(rand() * 72);
    generated.push({ price: (priceCents / 100).toFixed(2), fee: (feeCents / 100).toFixed(2), months });
  }

  test(`every one of ${CASES} generated (price, fee, months) cases: regular*(months-1) + final === price - fee, exactly, in cents`, () => {
    let examined = 0;
    for (const { price, fee, months } of generated) {
      const schedule = deriveInstalmentSchedule(price, fee, months);
      expect(schedule, `price=${price} fee=${fee} months=${months} unexpectedly rejected`).not.toBeNull();
      const { regular, final } = schedule!;
      const sum = regular.mul(months - 1).add(final);
      const expected = D(price).sub(D(fee));
      expect(sum.toFixed(2), `price=${price} fee=${fee} months=${months}`).toBe(expected.toFixed(2));
      // The defect this whole function exists to prevent: a final instalment
      // SMALLER than a regular one. Equal is fine (evenly divisible); less
      // never is — a signed contract's last payment must never read smaller
      // than every payment before it.
      expect(final.greaterThanOrEqualTo(regular), `final < regular for price=${price} fee=${fee} months=${months}`).toBe(true);
      examined++;
    }
    // This assertion examined all 2000 generated cases, one at a time — not
    // a sample, not a subset that happened to pass.
    expect(examined).toBe(CASES);
  });
});

describe("deriveInstalmentSchedule — the five worked examples named in the brief, as explicit regressions on top of the generated sweep", () => {
  // Row 4 sums to the price MINUS the booking fee (4500.00), never the full
  // price (5000.00) — the booking fee is its own, separate payment (sequence
  // 0), not one of the N instalments (server/sales/actions.ts's own comment
  // on the sale-side schedule makes the same point).
  const CASES: [string, string, number, string, string][] = [
    ["1000", "0", 3, "333.33", "333.34"],
    ["1000", "0", 12, "83.33", "83.37"],
    ["2999", "0", 12, "249.91", "249.99"],
    ["5000", "500", 24, "187.50", "187.50"],
    ["999.99", "0", 36, "27.77", "28.04"],
  ];

  test.each(CASES)("price=%s fee=%s months=%s -> regular %s, final %s", (price, fee, months, regular, final) => {
    const schedule = deriveInstalmentSchedule(price, fee, months);
    expect(schedule).not.toBeNull();
    expect(schedule!.regular.toFixed(2)).toBe(regular);
    expect(schedule!.final.toFixed(2)).toBe(final);
    // The corrected invariant: the schedule sums to price − fee, not price.
    const sum = schedule!.regular.mul(months - 1).add(schedule!.final);
    expect(sum.toFixed(2)).toBe(D(price).sub(D(fee)).toFixed(2));
  });

  // This file examined 5 named cases here, on top of the 2000 generated
  // above — stated explicitly rather than left to be counted by hand.
  test("sanity: exactly 5 named cases were examined above, not fewer", () => {
    expect(CASES).toHaveLength(5);
  });
});

describe("deriveInstalmentSchedule — five 72-month cases (the new real maximum, owner's ruling), hand-derived, as regressions on top of the generated sweep", () => {
  // Hand-derived independently of the implementation, same discipline as
  // the five above. Two of these (5000/500 and 850/50) repeat the exact
  // figures AD re-derived and verified while correcting the sum-invariant
  // mistake in the brief itself — reusing them here is not circular: AD's
  // correction was about what the SUM equals (price − fee, not price),
  // never about regular/final, which were "EXACT" in AD's own words.
  //
  //   5000/500/72: basis 4500.00 -> 450000c / 72 = 6250.00c EXACTLY (no
  //     remainder) -> regular == final == 62.50, sum 4500.00.
  //   850/50/72:   basis 800.00  -> 80000c / 72 = 1111c remainder 8c ->
  //     regular 11.11, final 80000 - 1111*71 = 1119c = 11.19, sum 800.00.
  //   1000/0/72:   100000c / 72 = 1388c remainder 64c -> regular 13.88,
  //     final 100000 - 1388*71 = 1452c = 14.52, sum 1000.00. This is the
  //     exact case the brief quotes as UI copy ("71 payments of $13.88,
  //     final payment $14.52") — the 64-cent gap AD flagged as no longer
  //     invisible to a customer.
  //   999.99/0/72: 99999c / 72 = 1388c remainder 63c -> regular 13.88,
  //     final 99999 - 1388*71 = 1451c = 14.51, sum 999.99.
  //   2999/0/72:   299900c / 72 = 4165c remainder 20c -> regular 41.65,
  //     final 299900 - 4165*71 = 4185c = 41.85, sum 2999.00.
  const CASES_72: [string, string, number, string, string][] = [
    ["5000", "500", 72, "62.50", "62.50"],
    ["850", "50", 72, "11.11", "11.19"],
    ["1000", "0", 72, "13.88", "14.52"],
    ["999.99", "0", 72, "13.88", "14.51"],
    ["2999", "0", 72, "41.65", "41.85"],
  ];

  test.each(CASES_72)("price=%s fee=%s months=%s -> regular %s, final %s", (price, fee, months, regular, final) => {
    const schedule = deriveInstalmentSchedule(price, fee, months);
    expect(schedule).not.toBeNull();
    expect(schedule!.regular.toFixed(2)).toBe(regular);
    expect(schedule!.final.toFixed(2)).toBe(final);
    const sum = schedule!.regular.mul(months - 1).add(schedule!.final);
    expect(sum.toFixed(2)).toBe(D(price).sub(D(fee)).toFixed(2));
  });

  test("sanity: exactly 5 named 72-month cases were examined above, not fewer", () => {
    expect(CASES_72).toHaveLength(5);
  });
});

describe("deriveInstalmentSchedule — edge cases the brief explicitly delegates, with the reasoning for each call", () => {
  test("fee > price: REJECTED outright (returns null) — a negative basis is refused, never silently floored", () => {
    expect(deriveInstalmentSchedule("100.00", "100.01", 12)).toBeNull();
  });

  test("fee === price: ALLOWED — a well-defined $0.00-every-instalment schedule. Arithmetically consistent; rejecting it would be an unrequested business rule, not a safety guarantee like the negative-basis case above", () => {
    const schedule = deriveInstalmentSchedule("100.00", "100.00", 12);
    expect(schedule).not.toBeNull();
    expect(schedule!.regular.toFixed(2)).toBe("0.00");
    expect(schedule!.final.toFixed(2)).toBe("0.00");
  });

  test("months = 1: one payment, regular === final === the full basis", () => {
    const schedule = deriveInstalmentSchedule("1000.00", "0", 1);
    expect(schedule).not.toBeNull();
    expect(schedule!.regular.toFixed(2)).toBe("1000.00");
    expect(schedule!.final.toFixed(2)).toBe("1000.00");
  });

  // months = 1200: no longer reachable through the real policy at all
  // (lib/schemas.ts instalmentPlanShape, and the DB's own
  // months_within_policy CHECK constraint, both cap at 72 — owner's ruling,
  // 2026-10-09 addendum). This function itself still has no opinion on
  // policy, only on arithmetic, so it happily computes a consistent,
  // well-defined schedule that is commercially absurd (a 100-year payment
  // plan at 83 cents a month) — kept here specifically to document that the
  // POLICY ceiling lives in the schema and the database, never in this pure
  // function, so a future reader doesn't go looking for it here.
  test("months = 1200 on $1000 (unreachable via policy — a pure-arithmetic check only): consistent (0.83 x 1199 + 4.83 = 1000.00) but absurd — not this function's problem to fix", () => {
    const schedule = deriveInstalmentSchedule("1000.00", "0", 1200);
    expect(schedule).not.toBeNull();
    expect(schedule!.regular.toFixed(2)).toBe("0.83");
    expect(schedule!.final.toFixed(2)).toBe("4.83");
    const sum = schedule!.regular.mul(1199).add(schedule!.final);
    expect(sum.toFixed(2)).toBe("1000.00");
  });
});
