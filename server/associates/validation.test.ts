import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    associate: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createAssociate } from "@/server/associates/actions";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin", associateId: null } });
  prismaMock.associate.findFirst.mockResolvedValue(null);
  prismaMock.associate.findUnique.mockResolvedValue(null);
  prismaMock.associate.create.mockResolvedValue({});
});

describe("createAssociate validation", () => {
  it("rejects malformed input (empty fullName) as invalidInput", async () => {
    const r = await createAssociate({ fullName: "", designation: "SalesAssociate" });
    expect(r).toEqual({ ok: false, error: "invalidInput" });
  });

  it("does not reject cleared optional fields sent as empty strings (form clears to '', not undefined)", async () => {
    const r = await createAssociate({
      fullName: "Jane Tan",
      designation: "SalesAssociate",
      email: "",
      nric: "",
      dateOfBirth: "",
      bankAccountNumber: "",
    });
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });
});
