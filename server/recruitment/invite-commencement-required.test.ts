import { describe, it, expect, vi, beforeEach } from "vitest";

// Commencement Date is a required field on the Associate Agreement (register row
// C2a). These assert the SERVER refuses an invite without one — the form's own
// `required` is not what is under test. Mutation proof: making
// `commencementDate` optional in inviteCandidateSchema (lib/schemas.ts) makes the
// blank / missing / whitespace cases reach candidate.create and fail below.

const { authMock, prismaMock, sendMailMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    candidate: { create: vi.fn() },
    associate: { findUnique: vi.fn() },
    team: { findMany: vi.fn() },
  },
  sendMailMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));
vi.mock("@/lib/pdf/agreement", () => ({ renderAgreementPdf: vi.fn() }));
vi.mock("@/lib/mail", () => ({
  sendMail: sendMailMock,
  onboardingInviteEmail: vi.fn(() => ({ subject: "s", html: "h" })),
  approvalEmail: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({ putObject: vi.fn(), getObject: vi.fn() }));

import { inviteCandidate } from "@/server/recruitment/actions";
import { inviteCandidateSchema } from "@/lib/schemas";

const input = {
  fullName: "Jane Tan",
  mobileNumber: "91234567",
  email: "jane@example.com",
  intendedDesignation: "SalesAssociate" as const,
  commencementDate: "2026-10-15",
};

beforeEach(() => {
  vi.clearAllMocks();
  sendMailMock.mockResolvedValue({ sent: true });
  prismaMock.team.findMany.mockResolvedValue([]);
  prismaMock.associate.findUnique.mockResolvedValue({ teamName: "Alpha" });
  prismaMock.candidate.create.mockResolvedValue({ id: "cand1", fullName: input.fullName, onboardingToken: "tok123" });
  authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin", associateId: null } });
});

describe("inviteCandidate — Commencement Date is required (server-side)", () => {
  // Control: a valid date still creates the candidate, with that date. Without it a
  // reject-everything guard would satisfy the rejection cases vacuously.
  it("accepts a valid date and stores it", async () => {
    const r = await inviteCandidate(input);
    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.candidate.create.mock.calls[0][0].data.commencementDate).toEqual(new Date("2026-10-15"));
  });

  it.each([
    ["blank", ""],
    ["whitespace only", "   "],
  ])("rejects a %s date with commencementDateRequired, before create or sendMail", async (_label, value) => {
    const r = await inviteCandidate({ ...input, commencementDate: value });
    expect(r).toEqual({ ok: false, error: "commencementDateRequired" });
    expect(prismaMock.candidate.create).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("rejects a missing date (a caller that omits the field entirely)", async () => {
    const withoutDate: Partial<typeof input> = { ...input };
    delete withoutDate.commencementDate;
    const r = await inviteCandidate(withoutDate as typeof input);
    expect(r).toEqual({ ok: false, error: "commencementDateRequired" });
    expect(prismaMock.candidate.create).not.toHaveBeenCalled();
  });

  it.each([
    ["not a date", "soon"],
    ["impossible calendar date", "2026-02-31"],
    ["wrong format", "15/10/2026"],
    ["datetime, not a date", "2026-10-15T00:00:00Z"],
  ])("rejects %s with commencementDateInvalid", async (_label, value) => {
    const r = await inviteCandidate({ ...input, commencementDate: value });
    expect(r).toEqual({ ok: false, error: "commencementDateInvalid" });
    expect(prismaMock.candidate.create).not.toHaveBeenCalled();
  });

  it("applies to every role that may invite, not only Business Admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u3", role: "SalesManager", associateId: "a3" } });
    const r = await inviteCandidate({ ...input, commencementDate: "" });
    expect(r.ok).toBe(false);
    expect(prismaMock.candidate.create).not.toHaveBeenCalled();
  });
});

describe("inviteCandidateSchema — commencementDate", () => {
  const ok = { email: "jane@example.com" };
  it("passes a real yyyy-mm-dd date and trims it", () => {
    expect(inviteCandidateSchema.safeParse({ ...ok, commencementDate: " 2026-10-15 " }).data?.commencementDate).toBe("2026-10-15");
  });
  it("accepts a leap day and rejects a non-leap one", () => {
    expect(inviteCandidateSchema.safeParse({ ...ok, commencementDate: "2028-02-29" }).success).toBe(true);
    expect(inviteCandidateSchema.safeParse({ ...ok, commencementDate: "2027-02-29" }).success).toBe(false);
  });
  it("fails when the field is absent", () => {
    expect(inviteCandidateSchema.safeParse(ok).success).toBe(false);
  });
});
