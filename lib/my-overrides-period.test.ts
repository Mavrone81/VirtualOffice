import { describe, it, expect } from "vitest";
import { resolveMyOverridesPeriod } from "./my-overrides-period";

const NOW = new Date("2026-03-15T00:00:00Z"); // arbitrary fixed "now" for defaulting

describe("resolveMyOverridesPeriod", () => {
  it("defaults to the current month and year, and OVERALL, when no params are given", () => {
    const r = resolveMyOverridesPeriod({}, NOW);
    expect(r.view).toBe("overall");
    expect(r.month).toBe(3);
    expect(r.year).toBe(2026);
    expect(r.payoutMonth).toBe("2026-03");
  });

  it("honours an explicit moView=received", () => {
    expect(resolveMyOverridesPeriod({ moView: "received" }, NOW).view).toBe("received");
  });

  it("treats any value other than the literal 'received' as overall (never a silent 500 on a typo'd param)", () => {
    expect(resolveMyOverridesPeriod({ moView: "garbage" }, NOW).view).toBe("overall");
  });

  it("honours explicit moMonth/moYear and builds the matching payoutMonth", () => {
    const r = resolveMyOverridesPeriod({ moMonth: "11", moYear: "2024" }, NOW);
    expect(r.month).toBe(11);
    expect(r.year).toBe(2024);
    expect(r.payoutMonth).toBe("2024-11");
  });

  it("zero-pads a single-digit month in payoutMonth", () => {
    expect(resolveMyOverridesPeriod({ moMonth: "1" }, NOW).payoutMonth).toBe("2026-01");
  });

  it.each(["0", "13", "abc", ""])("falls back to the current month for an out-of-range or non-numeric moMonth=%s", (bad) => {
    expect(resolveMyOverridesPeriod({ moMonth: bad }, NOW).month).toBe(3);
  });

  it.each(["1999", "3000", "abc"])("falls back to the current year for an out-of-range or non-numeric moYear=%s", (bad) => {
    expect(resolveMyOverridesPeriod({ moYear: bad }, NOW).year).toBe(2026);
  });

  it("yearOptions always includes the current year and is centred on it", () => {
    const r = resolveMyOverridesPeriod({}, NOW);
    expect(r.yearOptions).toContain(2026);
    expect(r.yearOptions).toEqual([2022, 2023, 2024, 2025, 2026]);
  });
});
