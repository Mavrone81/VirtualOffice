import { describe, it, expect } from "vitest";
import { INSTALLMENT_MONTHS } from "./installment-months";

describe("INSTALLMENT_MONTHS", () => {
  it("offers every value from 1 to 24, matching the server's saleSchema bound", () => {
    expect(INSTALLMENT_MONTHS).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(INSTALLMENT_MONTHS[0]).toBe(1);
    expect(INSTALLMENT_MONTHS.at(-1)).toBe(24);
    expect(INSTALLMENT_MONTHS).toHaveLength(24);
  });
});
