import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { candidate: { findUnique: vi.fn(), delete: vi.fn() } },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
// The recruitment module transitively imports a JSX PDF renderer + mail/storage;
// mock them so this unit test doesn't load them.
vi.mock("@/lib/pdf/agreement", () => ({ renderAgreementPdf: vi.fn() }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(), onboardingInviteEmail: vi.fn(), approvalEmail: vi.fn() }));
vi.mock("@/lib/storage", () => ({ putObject: vi.fn(), getObject: vi.fn() }));

import { cancelInvite } from "@/server/recruitment/actions";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.candidate.delete.mockResolvedValue({});
});

describe("cancelInvite", () => {
  it("lets the inviter cancel their own pending invite (deletes the record → invalidates the link)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesDirector" } });
    prismaMock.candidate.findUnique.mockResolvedValue({ invitedById: "u1", convertedAssociateId: null });
    const r = await cancelInvite("c1");
    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("rejects someone who did not send the invite (and is not an admin)", async () => {
    authMock.mockResolvedValue({ user: { id: "u2", role: "SalesDirector" } });
    prismaMock.candidate.findUnique.mockResolvedValue({ invitedById: "u1", convertedAssociateId: null });
    const r = await cancelInvite("c1");
    expect(r.ok).toBe(false);
    expect(prismaMock.candidate.delete).not.toHaveBeenCalled();
  });

  it("lets an admin cancel any pending invite", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.candidate.findUnique.mockResolvedValue({ invitedById: "someoneelse", convertedAssociateId: null });
    expect((await cancelInvite("c1")).ok).toBe(true);
  });

  it("refuses to cancel a candidate already converted to an associate", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin" } });
    prismaMock.candidate.findUnique.mockResolvedValue({ invitedById: "u1", convertedAssociateId: "assoc1" });
    const r = await cancelInvite("c1");
    expect(r.ok).toBe(false);
    expect(prismaMock.candidate.delete).not.toHaveBeenCalled();
  });
});
