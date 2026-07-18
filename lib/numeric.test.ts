import { describe, it, expect } from "vitest";
import { sanitizeAmountInput } from "./numeric";

// Global Rule 1 (16-Jul): every value field accepts a number with at most 2
// decimal places. sanitizeAmountInput is the shared keystroke sanitizer.
describe("sanitizeAmountInput", () => {
  it("keeps up to 2 decimal places, drops the rest", () => {
    expect(sanitizeAmountInput("12.345")).toBe("12.34");
    expect(sanitizeAmountInput("12.3")).toBe("12.3");
    expect(sanitizeAmountInput("12")).toBe("12");
    expect(sanitizeAmountInput("0.5")).toBe("0.5");
  });
  it("allows a trailing dot mid-typing", () => {
    expect(sanitizeAmountInput("12.")).toBe("12.");
  });
  it("strips non-numeric characters and extra dots", () => {
    expect(sanitizeAmountInput("1a2.b3")).toBe("12.3");
    expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
    expect(sanitizeAmountInput("$50")).toBe("50");
  });
  it("passes through empty", () => {
    expect(sanitizeAmountInput("")).toBe("");
  });
});
