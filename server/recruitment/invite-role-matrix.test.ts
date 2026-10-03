import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppRole } from "@prisma/client";

// Per-role gating matrix for the candidate-invite flow. Every AppRole is listed,
// so a role that is accidentally granted (or a new enum value nobody classified)
// fails here instead of passing by omission. Values below were captured against
// the code BEFORE the invite-parity change and must not move, except the rows
// tagged TEAM-RULE (the one intended difference: team is a choice for Business
// Admin only).
//
// Three authorities exist and DISAGREE (lib/roles.ts, lib/quota.ts) — they are
// asserted separately, never collapsed:
//   canRecruit   RECRUITER_ROLES = SalesManager, SalesDirector, Admin
//   isManagerRole MANAGER_ROLES  = SalesAssistantManager, SalesManager, SalesDirector
//   canSetQuota  SAM and above (+ Admin)
// Sales Assistant Manager is the only role where all three differ.

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

import { inviteCandidate, myRecruiterTeams } from "@/server/recruitment/actions";
import { RECRUITER_ROLES, MANAGER_ROLES, canRecruit, isManagerRole } from "@/lib/roles";
import { isAdminRole } from "@/lib/rbac";
import { canSetQuota } from "@/lib/quota";

type Row = { recruit: boolean; adminArea: boolean; manager: boolean; quota: boolean };
const MATRIX: Record<AppRole, Row> = {
  Admin:                 { recruit: true,  adminArea: true,  manager: false, quota: true },
  Accounts:              { recruit: false, adminArea: true,  manager: false, quota: false },
  SalesDirector:         { recruit: true,  adminArea: false, manager: true,  quota: true },
  SalesManager:          { recruit: true,  adminArea: false, manager: true,  quota: true },
  SalesAssistantManager: { recruit: false, adminArea: false, manager: true,  quota: true },
  SalesAssociate:        { recruit: false, adminArea: false, manager: false, quota: false },
};
const ROLES = Object.keys(MATRIX) as AppRole[];

const valid = {
  fullName: "Test Candidate",
  mobileNumber: "90000000",
  email: "candidate@example.invalid",
  intendedDesignation: "SalesManager" as const,
  intendedDirectUplineCode: "EN0001",
  commencementDate: "2026-10-15",
};

function as(role: AppRole, teams: string[] = ["Alpha"]) {
  authMock.mockResolvedValue({ user: { id: `u-${role}`, role, associateId: role === "Admin" || role === "Accounts" ? null : "assoc-1" } });
  prismaMock.team.findMany.mockResolvedValue(teams.map((name) => ({ name })));
  prismaMock.associate.findUnique.mockImplementation(async (a: { where: { associateCode?: string } }) =>
    a.where.associateCode ? { id: "up-1" } : { teamName: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMailMock.mockResolvedValue({ sent: true });
  prismaMock.candidate.create.mockResolvedValue({ id: "c1", fullName: valid.fullName });
});

describe("role matrix covers the whole AppRole enum", () => {
  it("lists exactly the enum's roles", () => {
    expect([...ROLES].sort()).toEqual(Object.values(AppRole).sort());
  });
});

describe.each(ROLES)("%s", (role) => {
  const row = MATRIX[role];

  it("authority predicates (three sets, asserted separately)", () => {
    expect(canRecruit(role)).toBe(row.recruit);
    expect(RECRUITER_ROLES.includes(role)).toBe(row.recruit);
    expect(isAdminRole(role)).toBe(row.adminArea); // /admin/* layout gate
    expect(isManagerRole(role)).toBe(row.manager);
    expect(MANAGER_ROLES.includes(role)).toBe(row.manager);
    expect(canSetQuota(role)).toBe(row.quota);
  });

  it("inviteCandidate: reachable only if it may recruit; sets every field", async () => {
    as(role);
    const r = await inviteCandidate({ ...valid, intendedTeam: role === "Admin" ? "Alpha" : undefined });
    if (!row.recruit) {
      expect(r).toEqual({ ok: false, error: "forbidden" });
      expect(prismaMock.candidate.create).not.toHaveBeenCalled();
      expect(sendMailMock).not.toHaveBeenCalled();
      return;
    }
    expect(r.ok).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const d = prismaMock.candidate.create.mock.calls[0][0].data;
    expect(d).toMatchObject({
      fullName: valid.fullName,
      mobileNumber: valid.mobileNumber,
      email: valid.email,
      intendedDesignation: "SalesManager",
      intendedDirectUplineId: "up-1",
      intendedTeam: "Alpha",
      onboardingStage: "Invited",
      invitedById: `u-${role}`,
    });
    expect(d.commencementDate).toEqual(new Date("2026-10-15"));
  });

  it("Commencement Date is required on this path (blank, missing, invalid)", async () => {
    for (const bad of ["", "   ", undefined, "2026-13-45", "not-a-date"]) {
      vi.clearAllMocks();
      as(role);
      const r = await inviteCandidate({ ...valid, commencementDate: bad as unknown as string });
      expect(r.ok).toBe(false);
      expect(r.error).toBe(row.recruit ? (bad === "2026-13-45" || bad === "not-a-date" ? "commencementDateInvalid" : "commencementDateRequired") : "forbidden");
      expect(prismaMock.candidate.create).not.toHaveBeenCalled();
    }
  });

  it("myRecruiterTeams: only a non-admin recruiter gets a list", async () => {
    as(role, ["Alpha", "Beta"]);
    const teams = await myRecruiterTeams();
    expect(teams).toEqual(row.recruit && !row.adminArea ? ["Alpha", "Beta"] : []);
  });

  // TEAM-RULE rows: who may choose a team that is not their own.
  it("TEAM-RULE: a team that is not the caller's own", async () => {
    as(role, ["Alpha"]);
    const r = await inviteCandidate({ ...valid, intendedTeam: "Zeta" });
    if (!row.recruit) return expect(r.error).toBe("forbidden");
    if (row.adminArea) {
      expect(r.ok).toBe(true); // Business Admin places into ANY team
      expect(prismaMock.candidate.create.mock.calls[0][0].data.intendedTeam).toBe("Zeta");
    } else {
      expect(r).toEqual({ ok: false, error: "teamNotYours" });
      expect(prismaMock.candidate.create).not.toHaveBeenCalled();
    }
  });

  it("TEAM-RULE: single own team is implied when none is sent (non-admin)", async () => {
    as(role, ["Alpha"]);
    const r = await inviteCandidate({ ...valid });
    if (!row.recruit) return expect(r.error).toBe("forbidden");
    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create.mock.calls[0][0].data.intendedTeam).toBe(row.adminArea ? null : "Alpha");
  });

  it("TEAM-RULE: several own teams and none sent is refused, never defaulted (non-admin)", async () => {
    as(role, ["Alpha", "Beta"]);
    const r = await inviteCandidate({ ...valid });
    if (!row.recruit) return expect(r.error).toBe("forbidden");
    if (row.adminArea) {
      expect(r.ok).toBe(true);
    } else {
      expect(r).toEqual({ ok: false, error: "teamRequired" });
      expect(prismaMock.candidate.create).not.toHaveBeenCalled();
    }
  });

  // Changed by the parity patch (previously the free-text team was trusted when
  // a non-admin had no team at all). Admin behaviour is unchanged.
  it("TEAM-RULE: caller with NO team of their own cannot name one (non-admin); Admin still can", async () => {
    as(role, []);
    const r = await inviteCandidate({ ...valid, intendedTeam: "Zeta" });
    if (!row.recruit) return expect(r.error).toBe("forbidden");
    if (row.adminArea) {
      expect(r.ok).toBe(true);
      expect(prismaMock.candidate.create.mock.calls[0][0].data.intendedTeam).toBe("Zeta");
    } else {
      expect(r).toEqual({ ok: false, error: "teamNotYours" });
      expect(prismaMock.candidate.create).not.toHaveBeenCalled();
    }
  });

  it("TEAM-RULE: several own teams, one named that is theirs, is accepted (non-admin)", async () => {
    as(role, ["Alpha", "Beta"]);
    const r = await inviteCandidate({ ...valid, intendedTeam: "Beta" });
    if (!row.recruit) return expect(r.error).toBe("forbidden");
    expect(r.ok).toBe(true);
    expect(prismaMock.candidate.create.mock.calls[0][0].data.intendedTeam).toBe("Beta");
  });
});
