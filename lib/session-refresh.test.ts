import { describe, it, expect, vi } from "vitest";
import type { JWT } from "next-auth/jwt";
import { revalidateToken, REVALIDATE_MS, type LiveUser } from "./session-refresh";

const NOW = 1_800_000_000_000;
const base: JWT = { sub: "u1", role: "SalesDirector", associateId: "a1", mustResetPassword: false, name: "Fake" };
const live = (over: Partial<LiveUser> = {}): LiveUser =>
  ({ isActive: true, role: "SalesDirector", associateId: "a1", mustResetPassword: false, ...over });

describe("revalidateToken (SEC-2)", () => {
  it("ends the session when the user has been deactivated", async () => {
    expect(await revalidateToken(base, async () => live({ isActive: false }), NOW)).toBeNull();
  });

  it("ends the session when the user no longer exists", async () => {
    expect(await revalidateToken(base, async () => null, NOW)).toBeNull();
  });

  it("fails closed on a lookup error and on a token without a subject", async () => {
    expect(await revalidateToken(base, async () => { throw new Error("db down"); }, NOW)).toBeNull();
    const load = vi.fn(async () => live());
    expect(await revalidateToken({ ...base, sub: undefined }, load, NOW)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("refreshes a demoted role, a changed associate and the reset flag from the DB", async () => {
    const t = await revalidateToken(base, async () => live({ role: "SalesAssociate", associateId: "a2", mustResetPassword: true }), NOW);
    expect(t).toMatchObject({ sub: "u1", name: "Fake", role: "SalesAssociate", associateId: "a2", mustResetPassword: true, chk: NOW });
  });

  it("skips the DB inside the revalidation window, and re-checks after it", async () => {
    const load = vi.fn(async () => live({ isActive: false }));
    const fresh = { ...base, chk: NOW - (REVALIDATE_MS - 1) };
    expect(await revalidateToken(fresh, load, NOW)).toBe(fresh);
    expect(load).not.toHaveBeenCalled();
    expect(await revalidateToken({ ...base, chk: NOW - REVALIDATE_MS }, load, NOW)).toBeNull();
    expect(load).toHaveBeenCalledOnce();
  });

  it("re-checks a legacy token that has no chk stamp", async () => {
    const load = vi.fn(async () => live());
    expect(await revalidateToken(base, load, NOW)).toMatchObject({ chk: NOW });
    expect(load).toHaveBeenCalledWith("u1");
  });
});
