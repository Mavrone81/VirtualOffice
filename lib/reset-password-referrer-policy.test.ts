import { describe, it, expect } from "vitest";
import { nextConfig } from "../next.config";

// #29: the single-use token lives in this page's own URL — Referrer-Policy
// must hold even if a future change on the page DOES emit a request.
describe("Referrer-Policy on /reset-password/[token]", () => {
  it("sets no-referrer for the reset-password route, and nothing wider", async () => {
    const rules = await nextConfig.headers!();
    const match = rules.find((r) => r.source === "/reset-password/:path*");
    expect(match?.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
  });
});
