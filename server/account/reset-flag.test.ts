import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
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
  it("clears mustResetPassword on a valid token reset", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "u2", passwordHash: "old" });

    await resetPassword("sometoken", "newStrongPw1");

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.update.mock.calls[0][0].data.mustResetPassword).toBe(false);
  });
});
