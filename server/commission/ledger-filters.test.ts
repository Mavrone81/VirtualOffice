import { describe, it, expect } from "vitest";
import { LedgerLineType } from "@prisma/client";
import { formatSGD } from "@/lib/money";
import { ledgerWhere, parseLedgerSearch } from "./ledger-filters";

describe("ledgerWhere — B-6 ledger query builder", () => {
  it("no filters → no where clause", () => {
    expect(ledgerWhere({})).toEqual({});
  });

  it("associate, line type, and date range each add their own AND clause", () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-10-01T00:00:00.000Z");
    expect(ledgerWhere({ associate: "a1", lineType: LedgerLineType.Override, from, to })).toEqual({
      AND: [
        { associateId: "a1" },
        { lineType: LedgerLineType.Override },
        { createdAt: { gte: from } },
        { createdAt: { lt: to } },
      ],
    });
  });
});

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("parseLedgerSearch — validates URL query params before they reach Prisma", () => {
  it("empty input → everything undefined", () => {
    expect(parseLedgerSearch({})).toEqual({ associate: undefined, lineType: undefined, from: undefined, to: undefined });
  });

  it("a valid UUID associate and line type pass through; garbage is dropped", () => {
    expect(parseLedgerSearch({ associate: VALID_UUID, lineType: LedgerLineType.AddOn }).associate).toBe(VALID_UUID);
    expect(parseLedgerSearch({ associate: VALID_UUID, lineType: LedgerLineType.AddOn }).lineType).toBe(LedgerLineType.AddOn);
    expect(parseLedgerSearch({ associate: "not-a-uuid" }).associate).toBeUndefined();
    expect(parseLedgerSearch({ lineType: "constructor" }).lineType).toBeUndefined();
  });

  it("`to` is exclusive — the UTC midnight starting the day after", () => {
    expect(parseLedgerSearch({ to: "2026-09-26" }).to).toEqual(new Date("2026-09-27T00:00:00.000Z"));
  });

  it("invalid calendar dates are dropped, not thrown", () => {
    expect(parseLedgerSearch({ from: "2026-02-30" }).from).toBeUndefined();
  });
});

describe("Nett column — negative lines (SEC-6(b) warn+approval can book a negative line) must display correctly", () => {
  it("a negative line amount keeps its sign, not silently shown as positive", () => {
    expect(formatSGD("-296")).toBe("S$-296.00");
    expect(formatSGD("-296")).not.toBe(formatSGD("296"));
  });

  it("a negative amount round-trips through Decimal without losing precision", () => {
    expect(formatSGD("-1234.5")).toBe("S$-1,234.50");
  });
});
