import { describe, it, expect, vi, beforeEach } from "vitest";

// A9 (owner ruling, 2026-09-26): recruitment invite is Manager and above — Sales
// Assistant Manager (SAM) is no longer eligible (reverses the earlier 1 Sep
// AM+ decision). This only gates NEW invites: candidates a SAM invited
// earlier are untouched (no data migration, nothing to assert here — there's
// simply no code path left that would revisit them).

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
  prismaMock.candidate.create.mockResolvedValue({
    id: "cand1",
    fullName: input.fullName,
    onboardingToken: "tok123",
  });
});

describe("inviteCandidate — role gate (A9: Manager and above)", () => {
  it("refuses a Sales Assistant Manager with forbidden and never creates the candidate", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "SalesAssistantManager", associateId: "a1" } });

    const r = await inviteCandidate(input);

    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.candidate.create).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("refuses a Sales Associate with forbidden", async () => {
    authMock.mockResolvedValue({ user: { id: "u2", role: "SalesAssociate", associateId: "a2" } });

    const r = await inviteCandidate(input);

    expect(r.ok).toBe(false);
    expect(r.error).toBe("forbidden");
    expect(prismaMock.candidate.create).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request", async () => {
    authMock.mockResolvedValue(null);

    const r = await inviteCandidate(input);

    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.candidate.create).not.toHaveBeenCalled();
  });

  it("allows a Sales Manager to invite", async () => {
    authMock.mockResolvedValue({ user: { id: "u3", role: "SalesManager", associateId: "a3" } });

    const r = await inviteCandidate(input);

    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create).toHaveBeenCalledTimes(1);
  });

  it("allows a Sales Director to invite", async () => {
    authMock.mockResolvedValue({ user: { id: "u4", role: "SalesDirector", associateId: "a4" } });

    const r = await inviteCandidate(input);

    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create).toHaveBeenCalledTimes(1);
  });

  it("allows Business Admin to invite (and skips the own-team restriction)", async () => {
    authMock.mockResolvedValue({ user: { id: "admin1", role: "Admin", associateId: null } });

    const r = await inviteCandidate(input);

    expect(r.ok).toBe(true);
    expect(prismaMock.team.findMany).not.toHaveBeenCalled();
    expect(prismaMock.candidate.create).toHaveBeenCalledTimes(1);
  });
});


// Added with the mail-parser DoS fix: inviteCandidate is the only writer of
// Candidate.email, and an unbounded address reaches nodemailer's parser via
// lib/mail.ts sendMail. These assert the bound rejects a hostile address BEFORE
// any candidate.create or sendMail. Mutation proof: deleting the validate() call
// in inviteCandidate makes both rejection cases reach create+sendMail and the
// two expect(...).not.toHaveBeenCalled() assertions fail.
describe("inviteCandidate — email bound (mail-parser DoS guard)", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "mgr", role: "SalesManager", associateId: "a9" } });
  });

  // Control: a legitimate address still reaches create + sendMail. Without it, a
  // reject-everything guard would satisfy the two rejection cases vacuously.
  it("accepts a normal address (guard is not reject-all)", async () => {
    const r = await inviteCandidate({ ...input, email: "valid@example.com" });
    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  // Over-length address — the length bound (.max(254), RFC 5321 maximum).
  it("rejects an over-length address before create or sendMail", async () => {
    const hostile = "a".repeat(300) + "@example.com";
    const r = await inviteCandidate({ ...input, email: hostile });
    expect(r).toEqual({ ok: false, error: "invalidInput" });
    expect(prismaMock.candidate.create).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  // Malformed structure, short enough that only .email() (not .max) catches it:
  // the group-colon shape measured as super-linear in the address parser.
  it("rejects a malformed address before create or sendMail", async () => {
    const hostile = "g" + ":".repeat(40) + "a@b.c";
    const r = await inviteCandidate({ ...input, email: hostile });
    expect(r).toEqual({ ok: false, error: "invalidInput" });
    expect(prismaMock.candidate.create).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
