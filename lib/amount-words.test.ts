import { describe, it, expect } from "vitest";
import { numberToWords, amountToWords } from "./amount-words";

describe("numberToWords", () => {
  it("handles zero and small numbers", () => {
    expect(numberToWords(0)).toBe("Zero");
    expect(numberToWords(7)).toBe("Seven");
    expect(numberToWords(13)).toBe("Thirteen");
    expect(numberToWords(40)).toBe("Forty");
    expect(numberToWords(99)).toBe("Ninety-Nine");
  });

  it("handles hundreds with the 'and' join", () => {
    expect(numberToWords(100)).toBe("One Hundred");
    expect(numberToWords(101)).toBe("One Hundred and One");
    expect(numberToWords(999)).toBe("Nine Hundred and Ninety-Nine");
  });

  it("handles thousands and millions", () => {
    expect(numberToWords(1000)).toBe("One Thousand");
    expect(numberToWords(1234)).toBe("One Thousand Two Hundred and Thirty-Four");
    expect(numberToWords(2_000_000)).toBe("Two Million");
    expect(numberToWords(2_001_005)).toBe("Two Million One Thousand Five");
  });

  it("rejects negatives", () => {
    expect(() => numberToWords(-1)).toThrow();
  });
});

describe("amountToWords", () => {
  it("whole dollars end in Only", () => {
    expect(amountToWords(3888)).toBe("Three Thousand Eight Hundred and Eighty-Eight Only");
  });

  it("includes cents when present", () => {
    expect(amountToWords(1250.5)).toBe("One Thousand Two Hundred and Fifty and Cents Fifty Only");
    expect(amountToWords("88.05")).toBe("Eighty-Eight and Cents Five Only");
  });

  it("accepts decimal strings (Prisma Decimal .toString())", () => {
    expect(amountToWords("3888.00")).toBe("Three Thousand Eight Hundred and Eighty-Eight Only");
  });

  it("rejects invalid input", () => {
    expect(() => amountToWords("not-a-number")).toThrow();
  });
});
