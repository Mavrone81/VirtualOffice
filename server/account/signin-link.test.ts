import { describe, it, expect, vi, beforeEach } from "vitest";

// #29: createSignInLink already exists (reuses the same resetTokenHash/
// resetTokenExpiresAt mechanism as self-service reset) but had zero test
// coverage — the "admin re-send link" requirement, tested for the first time.

const { authMock, prismaMock, canMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  canMock: vi.fn(),
  prismaMock: {
    associate: { findUnique: vi.fn() },
    user: { update: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
(prismaMock as Record<string, unknown>).$transaction = vi.fn(async (fn: (db: unknown) => unknown) => fn(prismaMock));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));
vi.mock("@/lib/rbac", () => ({ can: canMock }));
vi.mock("@/lib/env", () => ({ env: { AUTH_URL: "https://vo.example.com" } }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(), resetPasswordEmail: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));

import { createSignInLink } from "@/server/account/actions";

const ASSOC_ID = "a1";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
  canMock.mockReturnValue(true);
  prismaMock.user.update.mockResolvedValue({});
});

describe("createSignInLink", () => {
  it("forbids a session without manage_users", async () => {
    canMock.mockReturnValue(false);
    prismaMock.associate.findUnique.mockResolvedValue({ user: { id: "u1", isActive: true, email: "a@x.com" }, fullName: "A" });

    const r = await createSignInLink(ASSOC_ID);

    expect(r.ok).toBe(false);
    expect(prismaMock.associate.findUnique).not.toHaveBeenCalled();
  });

  it("refuses an associate with no login and one with an inactive login", async () => {
    prismaMock.associate.findUnique.mockResolvedValueOnce({ user: null, fullName: "A" });
    expect((await createSignInLink(ASSOC_ID)).ok).toBe(false);

    prismaMock.associate.findUnique.mockResolvedValueOnce({ user: { id: "u1", isActive: false, email: "a@x.com" }, fullName: "A" });
    expect((await createSignInLink(ASSOC_ID)).ok).toBe(false);
  });

  it("issues a one-time link, never a password, with the associate's own name and email", async () => {
    prismaMock.associate.findUnique.mockResolvedValue({ user: { id: "u1", isActive: true, email: "jane@x.com" }, fullName: "Jane Tan" });

    const r = await createSignInLink(ASSOC_ID);

    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/^https:\/\/vo\.example\.com\/reset-password\/\S+$/);
    expect(r.email).toBe("jane@x.com");
    expect(r.name).toBe("Jane Tan");
    expect(Object.keys(r)).not.toContain("tempPassword");
    expect(Object.keys(r)).not.toContain("password");
  });

  // #29: the TTL is asserted directly rather than inferred from "ok: true" —
  // a link that issues but never expires, or expires too soon, both look
  // identical to this point without checking the actual stored value.
  it("sets resetTokenExpiresAt to exactly 72h ahead, via the transaction", async () => {
    prismaMock.associate.findUnique.mockResolvedValue({ user: { id: "u1", isActive: true, email: "jane@x.com" }, fullName: "Jane Tan" });
    const txUserUpdate = vi.fn().mockResolvedValue({});
    (prismaMock as Record<string, unknown>).$transaction = vi.fn(async (fn: (db: unknown) => unknown) =>
      fn({ user: { update: txUserUpdate }, auditLog: { create: vi.fn().mockResolvedValue({}) } }),
    );

    const before = Date.now();
    await createSignInLink(ASSOC_ID);
    const after = Date.now();

    expect(txUserUpdate).toHaveBeenCalledOnce();
    const expiresAt = (txUserUpdate.mock.calls[0][0].data.resetTokenExpiresAt as Date).getTime();
    const SEVENTY_TWO_H = 72 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + SEVENTY_TWO_H);
    expect(expiresAt).toBeLessThanOrEqual(after + SEVENTY_TWO_H);
  });
});
