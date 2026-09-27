import { describe, it, expect } from "vitest";
import { resolvePeriod } from "./period";

describe("resolvePeriod — B-6 chart period selector (all computed in UTC)", () => {
  const now = new Date("2026-11-15T09:00:00.000Z"); // Q4, November

  it("month: the current calendar month, to exclusive", () => {
    expect(resolvePeriod("month", now)).toEqual({
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2026-12-01T00:00:00.000Z"),
    });
  });

  it("quarter: the current calendar quarter, to exclusive", () => {
    expect(resolvePeriod("quarter", now)).toEqual({
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: new Date("2027-01-01T00:00:00.000Z"), // rolls into next year correctly
    });
  });

  it("year: the current calendar year, to exclusive", () => {
    expect(resolvePeriod("year", now)).toEqual({
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2027-01-01T00:00:00.000Z"),
    });
  });

  it("custom: uses the given from/to (inclusive-day convention, to made exclusive)", () => {
    expect(resolvePeriod("custom", now, { from: "2026-06-01", to: "2026-06-30" })).toEqual({
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-07-01T00:00:00.000Z"),
    });
  });

  it("custom with garbage/missing bounds falls back to the current month, never throws", () => {
    expect(resolvePeriod("custom", now, { from: "not-a-date", to: undefined })).toEqual({
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2026-12-01T00:00:00.000Z"),
    });
  });

  it("a Q1 quarter doesn't roll into the previous year", () => {
    const q1 = new Date("2026-02-01T00:00:00.000Z");
    expect(resolvePeriod("quarter", q1)).toEqual({
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-04-01T00:00:00.000Z"),
    });
  });
});
