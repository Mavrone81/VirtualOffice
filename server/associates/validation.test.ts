import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    associate: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "a-new", ...data })) },
    // The associate-code sequence now also reads reserved candidate codes
    // (lib/associate-code.ts): none reserved in these fixtures.
    candidate: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
// Tier A writes run write + audit in a transaction: run the callback on the same mock.
(prismaMock as Record<string, unknown>).$transaction = vi.fn(async (fn: (db: unknown) => unknown) => fn(prismaMock));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));

import { createAssociate } from "@/server/associates/actions";

beforeEach(() => {
  // nextAssociateCode() queries findMany scoped to the "EN" prefix (see actions.ts).
  prismaMock.associate.findMany.mockResolvedValue([{ associateCode: "EN0100" }]);
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin", associateId: null } });
  prismaMock.associate.findFirst.mockResolvedValue(null);
  prismaMock.associate.findUnique.mockResolvedValue(null);
  prismaMock.associate.create.mockResolvedValue({ id: "a-new" } as never);
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
      email: "jane.tan@example.test",
      nric: "",
      dateOfBirth: "",
      bankAccountNumber: "",
    });
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });

  // email left that group deliberately. The login is provisioned from it AT
  // approval and never afterwards, so a blank one produces an associate who can
  // never sign in. blankToUndefined turns the form's "" into undefined, which the
  // now-required field rejects — the same outcome as omitting it entirely.
  it("REJECTS a blank email — no longer one of the clearable optional fields", async () => {
    expect(await createAssociate({ fullName: "Jane Tan", designation: "SalesAssociate", email: "" })).toEqual({
      ok: false,
      error: "invalidInput",
    });
    expect(await createAssociate({ fullName: "Jane Tan", designation: "SalesAssociate" })).toEqual({
      ok: false,
      error: "invalidInput",
    });
  });
});
