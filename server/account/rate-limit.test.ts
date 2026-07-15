import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, rateLimitMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
  rateLimitMock: {
    checkRateLimit: vi.fn(),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/rate-limit", () => rateLimitMock);
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ can: () => true }));
vi.mock("@/lib/env", () => ({ env: { AUTH_URL: "https://x" } }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(), resetPasswordEmail: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@node-rs/argon2", () => ({
  verify: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue("newhash"),
}));

import { requestPasswordReset } from "@/server/account/actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestPasswordReset rate limiting", () => {
  it("returns the existing neutral response and creates no reset token once rate-limited", async () => {
    rateLimitMock.checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSec: 900 });
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", isActive: true, email: "user@example.com" });

    const result = await requestPasswordReset("User@Example.com");

    expect(result).toEqual({ ok: true });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("checks and records against the lowercased+trimmed email", async () => {
    rateLimitMock.checkRateLimit.mockResolvedValue({ allowed: false });

    await requestPasswordReset("  User@Example.com  ");

    expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith("user@example.com", "password_reset");
    expect(rateLimitMock.recordFailure).toHaveBeenCalledWith("user@example.com", "password_reset");
  });

  it("records a failure and proceeds normally when under the limit", async () => {
    rateLimitMock.checkRateLimit.mockResolvedValue({ allowed: true });
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", isActive: true, email: "user@example.com" });

    const result = await requestPasswordReset("user@example.com");

    expect(result).toEqual({ ok: true });
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    expect(rateLimitMock.recordFailure).toHaveBeenCalledWith("user@example.com", "password_reset");
  });
});
