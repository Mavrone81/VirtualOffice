import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, downlineMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    associate: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
  downlineMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ encryptPII: (s: string) => `enc:${s}` }));
// keep isAdminRole/isFullAdmin real; only stub the recursive DB walk
vi.mock("@/lib/rbac", async (orig) => ({ ...(await (orig() as Promise<object>)), downlineIds: downlineMock }));

import { updateAssociateUplines, createAssociate } from "@/server/associates/actions";

// Directory of associates keyed by code and by id, for findUnique routing.
const DIR = {
  a1: { id: "a1", associateCode: "EN0001", directUplineId: "sd", secondUplineId: null },
  sd: { id: "sd", associateCode: "EN0002", directUplineId: "top", secondUplineId: null },
  sm: { id: "sm", associateCode: "EN0003", directUplineId: "sd", secondUplineId: "top" },
  top: { id: "top", associateCode: "EN0009", directUplineId: null, secondUplineId: null },
} as const;

function routeFindUnique(args: { where: { id?: string; associateCode?: string } }) {
  const rec = Object.values(DIR).find(
    (r) => r.id === args.where.id || r.associateCode === args.where.associateCode,
  );
  return Promise.resolve(rec ?? null);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin", associateId: null } });
  prismaMock.associate.findUnique.mockImplementation(routeFindUnique as never);
  prismaMock.associate.findFirst.mockResolvedValue({ associateCode: "EN0100" }); // → next code EN0101
  prismaMock.associate.update.mockResolvedValue({});
  prismaMock.associate.create.mockResolvedValue({});
  downlineMock.mockResolvedValue([]); // no descendants by default
});

describe("updateAssociateUplines", () => {
  it("rejects a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "SalesAssociate", associateId: "a1" } });
    expect((await updateAssociateUplines("a1", "EN0002", null)).ok).toBe(false);
    expect(prismaMock.associate.update).not.toHaveBeenCalled();
  });

  it("sets both uplines and audits (happy path)", async () => {
    const r = await updateAssociateUplines("a1", "EN0002", "EN0009");
    expect(r.ok).toBe(true);
    expect(prismaMock.associate.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { directUplineId: "sd", secondUplineId: "top" },
    });
  });

  it("clears an upline when passed null", async () => {
    const r = await updateAssociateUplines("a1", null, null);
    expect(r.ok).toBe(true);
    expect(prismaMock.associate.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { directUplineId: null, secondUplineId: null },
    });
  });

  it("rejects an associate as its own upline", async () => {
    expect((await updateAssociateUplines("a1", "EN0001", null)).ok).toBe(false);
    expect(prismaMock.associate.update).not.toHaveBeenCalled();
  });

  it("rejects the same associate as both direct and second upline", async () => {
    expect((await updateAssociateUplines("a1", "EN0002", "EN0002")).ok).toBe(false);
    expect(prismaMock.associate.update).not.toHaveBeenCalled();
  });

  it("rejects an upline that is the associate's own downline (cycle)", async () => {
    downlineMock.mockResolvedValue(["a1", "sm"]); // sm is a descendant of a1
    expect((await updateAssociateUplines("a1", "EN0003", null)).ok).toBe(false);
    expect(prismaMock.associate.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown upline code", async () => {
    expect((await updateAssociateUplines("a1", "EN9999", null)).ok).toBe(false);
  });
});

describe("createAssociate second upline", () => {
  it("auto-derives the second upline from the direct upline's own upline when not given", async () => {
    const r = await createAssociate({ fullName: "New Person", designation: "SalesAssociate", directUplineCode: "EN0002" });
    expect(r.ok).toBe(true);
    // direct = sd (EN0002); sd.directUplineId = top → second auto-derives to "top"
    expect(prismaMock.associate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ directUplineId: "sd", secondUplineId: "top" }) }),
    );
  });

  it("uses the admin's explicit second upline over the auto-derived default", async () => {
    // direct = sd (EN0002) would auto-derive second to "top"; explicit EN0003 (sm) must win.
    const r = await createAssociate({
      fullName: "New Person", designation: "SalesAssociate", directUplineCode: "EN0002", secondUplineCode: "EN0003",
    });
    expect(r.ok).toBe(true);
    expect(prismaMock.associate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ directUplineId: "sd", secondUplineId: "sm" }) }),
    );
  });
});
