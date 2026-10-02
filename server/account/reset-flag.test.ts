import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
// Tier A writes run write + audit in a transaction: run the callback on the same mock.
(prismaMock as Record<string, unknown>).$transaction = vi.fn(async (fn: (db: unknown) => unknown) => fn(prismaMock));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ can: () => true }));
vi.mock("@/lib/env", () => ({ env: { AUTH_URL: "https://x" } }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(), resetPasswordEmail: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@node-rs/argon2", () => ({
  verify: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue("newhash"),
}));

import { changePassword, resetPassword } from "@/server/account/actions";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.update.mockResolvedValue({});
});

describe("changePassword", () => {
  it("clears mustResetPassword when the user sets a new password", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", passwordHash: "old" });

    await changePassword("oldpw", "newStrongPw1");

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.update.mock.calls[0][0].data.mustResetPassword).toBe(false);
  });
});

describe("resetPassword (token flow)", () => {
  it("clears mustResetPassword AND the token itself on a valid reset — single-use", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "u2", passwordHash: "old" });

    await resetPassword("sometoken", "newStrongPw1");

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const data = prismaMock.user.update.mock.calls[0][0].data;
    expect(data.mustResetPassword).toBe(false);
    expect(data.resetTokenHash).toBeNull();
    expect(data.resetTokenExpiresAt).toBeNull();
  });

  // #29: the query itself must exclude an expired row, not just happen to
  // reject it elsewhere — asserts the WHERE clause, not only the outcome.
  it("queries with an expiry filter, so a hash-matching but expired row is excluded by the query", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await resetPassword("sometoken", "newStrongPw1");

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { resetTokenHash: expect.any(String), resetTokenExpiresAt: { gt: expect.any(Date) } },
    });
  });

  // #29: reused refused — the token was cleared by the first call (asserted
  // above), so the same token presented again can no longer match any row.
  it("refuses the same token on a second use, once the first use cleared it", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: "u2", passwordHash: "old" });
    const first = await resetPassword("sometoken", "newStrongPw1");
    expect(first.ok).toBe(true);

    prismaMock.user.findFirst.mockResolvedValueOnce(null); // the real DB: resetTokenHash is now null
    const second = await resetPassword("sometoken", "newStrongPw2");
    expect(second.ok).toBe(false);
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1); // not called again
  });

  // #29: a positive assertion, not just "no account enumeration" asserted
  // in prose. A token whose hash matches no row (the real-unknown case) and
  // one whose hash matched a row but failed the expiry condition both
  // resolve the SAME query to null — the action has no way to tell them
  // apart, and this proves it rather than describing it.
  it("returns the identical status and error for an unknown token and an expired one", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const unknown = await resetPassword("never-issued-token", "newStrongPw1");
    const expired = await resetPassword("real-but-expired-token", "newStrongPw1");
    expect(unknown).toEqual(expired);
    expect(unknown.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
