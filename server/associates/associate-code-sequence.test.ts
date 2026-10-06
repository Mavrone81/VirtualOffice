import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, downlineMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    associate: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    candidate: { findMany: vi.fn() },
  },
  downlineMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
(prismaMock as Record<string, unknown>).$transaction = vi.fn(async (fn: (db: unknown) => unknown) => fn(prismaMock));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ encryptPII: (s: string) => `enc:${s}` }));
vi.mock("@/lib/rbac", async (orig) => ({ ...(await (orig() as Promise<object>)), downlineIds: downlineMock }));

import { createAssociate } from "@/server/associates/actions";

// The table as it genuinely was on the shared dev DB: a leftover fixture code that
// sorts ABOVE every real EN#### code, because 'M' > 'E' lexicographically.
const ROWS = [
  { associateCode: "MYCOM-A1" },
  { associateCode: "AUDTSEC-U1" },
  { associateCode: "EN0102" },
  { associateCode: "EN0007" },
  { associateCode: "EN0001" },
];

/** Both mocks HONOUR the query, so the assertion is about the query the production
 *  code chooses to send — not about a value the test handed back. A mock that
 *  ignores `where` would pass whatever the implementation did. */
function applyQuery(args?: { where?: { associateCode?: { startsWith?: string } } }) {
  const prefix = args?.where?.associateCode?.startsWith;
  const rows = prefix ? ROWS.filter((r) => r.associateCode.startsWith(prefix)) : ROWS;
  return [...rows].sort((a, b) => b.associateCode.localeCompare(a.associateCode));
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin", associateId: null } });
  prismaMock.associate.findUnique.mockResolvedValue(null);
  prismaMock.associate.findMany.mockImplementation(async (args: never) => applyQuery(args));
  prismaMock.associate.findFirst.mockImplementation(async (args: never) => applyQuery(args)[0] ?? null);
  prismaMock.associate.create.mockResolvedValue({});
  // The sequence now draws its high-water mark from reserved candidate codes too;
  // default to none reserved, so the existing cases keep their original meaning.
  prismaMock.candidate.findMany.mockResolvedValue([]);
  downlineMock.mockResolvedValue([]);
});

describe("associate code sequence is derived only from the EN sequence", () => {
  it("ignores a non-EN code that sorts above the sequence, instead of restarting from its digits", async () => {
    const r = await createAssociate({ email: "fixture1@example.test", fullName: "New Person", designation: "SalesAssociate" });

    expect(r.ok).toBe(true);
    expect(prismaMock.associate.create).toHaveBeenCalledTimes(1);
    const code = prismaMock.associate.create.mock.calls[0][0].data.associateCode;

    // EN0102 is the real high-water mark, so the next code is EN0103.
    // Unscoped, "MYCOM-A1" sorts highest, its digits strip to "1", and this returns
    // EN0002 — a code that already exists, so every creation collides on the unique
    // index. That is the defect this asserts against.
    expect(code).toBe("EN0103");
    expect(code).not.toBe("EN0002");
  });

  it("asks the database only for codes in the sequence's own prefix", async () => {
    await createAssociate({ email: "fixture2@example.test", fullName: "Another Person", designation: "SalesAssociate" });
    expect(prismaMock.associate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { associateCode: { startsWith: "EN" } } }),
    );
  });

  // 🔴 THE DISAGREEING CASE. A fixture of only 4-digit codes passes against BOTH the
  // text-ordered and the numeric implementation, so it cannot distinguish them and is
  // worthless for this property. EN10000 sorts BELOW EN9999 in text order ('1' < '9'),
  // so a text-ordered maximum is stuck at EN9999 and re-proposes EN10000 forever.
  it("takes the NUMERIC maximum, so EN10000 does not sort below EN9999", async () => {
    const wide = [{ associateCode: "EN9999" }, { associateCode: "EN10000" }, { associateCode: "EN0007" }];
    prismaMock.associate.findMany.mockImplementation(async (args: never) => {
      const prefix = (args as { where?: { associateCode?: { startsWith?: string } } })?.where?.associateCode?.startsWith;
      return prefix ? wide.filter((r) => r.associateCode.startsWith(prefix)) : wide;
    });

    await createAssociate({ email: "fixture3@example.test", fullName: "Ten Thousandth", designation: "SalesAssociate" });

    const code = prismaMock.associate.create.mock.calls[0][0].data.associateCode;
    expect(code).toBe("EN10001");
    // What a text-ordered maximum would have produced — a code that already exists.
    expect(code).not.toBe("EN10000");
  });

  // 🔴 FINDING-3 REGRESSION. Codes are now reserved on a Candidate at signing and
  // printed into an immutable agreement before any Associate row exists. This path
  // (admin creates an associate directly, no candidate involved) used to read ONLY
  // the associate table, so it would hand out a number already printed on a signed
  // contract. The high-water mark must span both sources.
  it("does not reissue a code already RESERVED on a candidate, even though no associate holds it yet", async () => {
    prismaMock.associate.findMany.mockResolvedValue([{ associateCode: "EN0007" }]);
    prismaMock.candidate.findMany.mockResolvedValue([
      { reservedAssociateCode: "EN0008" },
      { reservedAssociateCode: "EN0009" }, // the real high-water mark lives here, not on an associate
    ]);

    await createAssociate({ email: "fixture4@example.test", fullName: "Admin Created", designation: "SalesAssociate" });

    const code = prismaMock.associate.create.mock.calls[0][0].data.associateCode;
    expect(code).toBe("EN0010");
    // What reading only the associate table produced: a number already stamped
    // into a signed agreement that nothing could then alter.
    expect(code).not.toBe("EN0008");
  });

  it("asks the database for reserved candidate codes under the same prefix scope", async () => {
    await createAssociate({ email: "fixture5@example.test", fullName: "Scope Check", designation: "SalesAssociate" });
    expect(prismaMock.candidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reservedAssociateCode: { startsWith: "EN" } } }),
    );
  });

  it("starts at EN0001 when no sequence codes exist at all", async () => {
    prismaMock.associate.findMany.mockResolvedValue([]);
    prismaMock.associate.findFirst.mockResolvedValue(null);
    prismaMock.candidate.findMany.mockResolvedValue([]);
    await createAssociate({ email: "fixture6@example.test", fullName: "First Person", designation: "SalesAssociate" });
    expect(prismaMock.associate.create.mock.calls[0][0].data.associateCode).toBe("EN0001");
  });
});
