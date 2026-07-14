import { describe, it, expect } from "vitest";
import { generateTempPassword } from "@/lib/temp-password";

describe("generateTempPassword", () => {
  it("returns a string of at least 12 characters", () => {
    expect(generateTempPassword().length).toBeGreaterThanOrEqual(12);
  });

  it("returns a different value on every call (cryptographically random)", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTempPassword()));
    expect(seen.size).toBe(50);
  });

  it("contains only url-safe characters", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateTempPassword()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
