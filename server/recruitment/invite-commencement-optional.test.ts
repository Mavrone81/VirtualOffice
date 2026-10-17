import { describe, it, expect, vi, beforeEach } from "vitest";

// Owner ruling 2026-10-17: Commencement Date on the INVITE is now a
// non-binding suggestion only — the candidate sets their own, mandatory,
// range-checked date at onboarding submit (see
// server/recruitment/onboarding-validation.test.ts / lib/schemas.test.ts's
// candidateCommencementDate coverage). This file replaces
// invite-commencement-required.test.ts, whose premise (the server refuses an
// invite without a date) is no longer true.
// Mutation proof: reverting inviteCandidateSchema's commencementDate back to
// required makes the blank/missing cases below fail (they'd be rejected
// instead of creating the candidate with a null date).

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

describe("inviteCandidate — Commencement Date is OPTIONAL (owner ruling 2026-10-17)", () => {
  // Control: a valid date still creates the candidate, with that date — a
  // reject-everything guard would satisfy the acceptance cases below vacuously
  // only if this one also happened to fail.
  it("accepts a valid date and stores it", async () => {
    const r = await inviteCandidate(input);
    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.candidate.create.mock.calls[0][0].data.commencementDate).toEqual(new Date("2026-10-15"));
  });

  it.each([
    ["blank", ""],
    ["whitespace only", "   "],
  ])("accepts a %s date — creates the candidate with a null commencementDate", async (_label, value) => {
    const r = await inviteCandidate({ ...input, commencementDate: value });
    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.candidate.create.mock.calls[0][0].data.commencementDate).toBeNull();
  });

  it("accepts a missing date (a caller that omits the field entirely)", async () => {
    const withoutDate: Partial<typeof input> = { ...input };
    delete withoutDate.commencementDate;
    const r = await inviteCandidate(withoutDate as typeof input);
    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create.mock.calls[0][0].data.commencementDate).toBeNull();
  });

  // A date that IS given is still checked for shape — an optional field isn't
  // a bypass for a garbage one.
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

  it("is optional for every role that may invite, not only Business Admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u3", role: "SalesManager", associateId: "a3" } });
    const r = await inviteCandidate({ ...input, commencementDate: "" });
    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create).toHaveBeenCalledTimes(1);
  });
});

describe("inviteCandidateSchema — commencementDate (optional)", () => {
  const ok = { email: "jane@example.com" };
  it("passes a real yyyy-mm-dd date and trims it", () => {
    expect(inviteCandidateSchema.safeParse({ ...ok, commencementDate: " 2026-10-15 " }).data?.commencementDate).toBe("2026-10-15");
  });
  it("accepts a leap day and rejects a non-leap one", () => {
    expect(inviteCandidateSchema.safeParse({ ...ok, commencementDate: "2028-02-29" }).success).toBe(true);
    expect(inviteCandidateSchema.safeParse({ ...ok, commencementDate: "2027-02-29" }).success).toBe(false);
  });
  it("passes when the field is absent", () => {
    expect(inviteCandidateSchema.safeParse(ok).success).toBe(true);
  });
});
