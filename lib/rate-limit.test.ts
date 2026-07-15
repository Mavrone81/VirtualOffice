import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { checkRateLimit, recordFailure, recordSuccess, LIMITS } from "./rate-limit";
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

  it("locks out under a concurrent burst (atomic increment defeats the race)", async () => {
    const concurrentId = ID + ":concurrent";
    await prisma.rateLimitAttempt.deleteMany({ where: { identifier: concurrentId } });

    // Fire more concurrent failures than the limit at once. With a
    // findUnique-then-upsert implementation, every request reads the same
    // stale row and overwrites the others' writes, so the count never
    // reaches LIMITS.login and the lockout is bypassed. With an atomic
    // INSERT ... ON CONFLICT ... DO UPDATE, Postgres serializes the
    // conflicting updates and the count genuinely reaches the limit.
    await Promise.all(
      Array.from({ length: LIMITS.login + 2 }, () => recordFailure(concurrentId, "login")),
    );

    const blocked = await checkRateLimit(concurrentId, "login");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});
