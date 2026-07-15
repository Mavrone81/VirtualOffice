import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { checkRateLimit, recordFailure, recordSuccess } from "./rate-limit";
const ID = "test:" + Date.now();
beforeEach(async () => { await prisma.rateLimitAttempt.deleteMany({ where: { identifier: ID } }); });
describe("rate-limit", () => {
  it("allows under the limit, locks at the limit, success resets", async () => {
    for (let i = 0; i < 5; i++) { expect((await checkRateLimit(ID, "login")).allowed).toBe(true); await recordFailure(ID, "login"); }
    const blocked = await checkRateLimit(ID, "login");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    await recordSuccess(ID, "login");
    expect((await checkRateLimit(ID, "login")).allowed).toBe(true);
  });
});
