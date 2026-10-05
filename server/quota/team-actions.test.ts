import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, logAuditMock, teamScopeIdsMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    associate: { findUnique: vi.fn() },
    salesQuota: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  },
  logAuditMock: vi.fn(),
  teamScopeIdsMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/team", () => ({ teamScopeIds: teamScopeIdsMock }));

import { setIndividualQuota, clearIndividualQuota } from "@/server/quota/team-actions";
import { setQuota } from "@/server/quota/actions";

// Fixture names only — no real person, team or company name anywhere here.
const ADMIN = { user: { id: "u-admin", role: "Admin" as const, associateId: null } };
const ACCOUNTS = { user: { id: "u-accounts", role: "Accounts" as const, associateId: null } };
const MANAGER = { user: { id: "u-manager", role: "SalesManager" as const, associateId: "a-manager" } };
const TARGET = "a-target";
const MONTH = "2026-10";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.associate.findUnique.mockResolvedValue({ id: TARGET });
  prismaMock.salesQuota.findUnique.mockResolvedValue(null);
  prismaMock.salesQuota.upsert.mockResolvedValue({});
  prismaMock.salesQuota.deleteMany.mockResolvedValue({ count: 1 });
});

describe("setIndividualQuota — Admin-only individual target, gated by role, not associate scope", () => {
  // T1 — the owner's exact case: a Business Admin has no Associate record
  // (associateId null) and no team membership, yet must be able to set an
  // individual target for an associate who is in no team of the admin's own
  // (the admin has none). setQuota (the manager path) rejects this by
  // design; setIndividualQuota must accept it.
  it("an Admin with associateId null sets an individual target for an associate outside any team of theirs", async () => {
    authMock.mockResolvedValue(ADMIN);
    const r = await setIndividualQuota({ associateId: TARGET, month: MONTH, amount: 5000 });
    expect(r.ok).toBe(true);
    expect(prismaMock.salesQuota.upsert).toHaveBeenCalledTimes(1);
    const call = prismaMock.salesQuota.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({ associateId: TARGET, month: MONTH, setByRole: "Admin", setById: "u-admin" });
  });

  // T3 — quotaAuthority(Accounts) is 0 and must stay 0; this is the direct
  // behavioural check (isFullAdmin, not canSetQuota, gates this action).
  it("refuses the Accounts role and writes no row", async () => {
    authMock.mockResolvedValue(ACCOUNTS);
    const r = await setIndividualQuota({ associateId: TARGET, month: MONTH, amount: 5000 });
    expect(r.ok).toBe(false);
    expect(prismaMock.salesQuota.upsert).not.toHaveBeenCalled();
  });

  // T4 — "no target" is the absence of a row, never a stored 0 or a negative.
  // Two cases, one row-count assertion each: the upsert must not fire at all.
  it.each([
    ["zero", 0],
    ["negative", -100],
  ])("refuses a %s amount and writes zero rows", async (_label, amount) => {
    authMock.mockResolvedValue(ADMIN);
    const r = await setIndividualQuota({ associateId: TARGET, month: MONTH, amount });
    expect(r.ok).toBe(false);
    expect(prismaMock.salesQuota.upsert).toHaveBeenCalledTimes(0);
  });

  // T5 — audit row: correct actor, and before/after amounts taken from the
  // existing row (if any) and the new amount.
  it("writes exactly one audit row with the acting admin and the before/after amounts", async () => {
    authMock.mockResolvedValue(ADMIN);
    prismaMock.salesQuota.findUnique.mockResolvedValue({
      amount: { toString: () => "3000" },
      setByRole: "SalesManager",
    });
    const r = await setIndividualQuota({ associateId: TARGET, month: MONTH, amount: 5000 });
    expect(r.ok).toBe(true);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0][0];
    expect(call.actorUserId).toBe("u-admin");
    expect(call.entityType).toBe("SalesQuota");
    expect(call.before).toEqual({ amount: "3000" });
    expect(call.after).toEqual({ amount: "5000" });
  });

  // Not explicitly required by T1-T6, but new production code written for
  // this change — left untested would be a real gap given the rest of this
  // file exists to prove coverage, not just claim it.
  it("an unknown associateId is refused before any write (not found, zero rows)", async () => {
    authMock.mockResolvedValue(ADMIN);
    prismaMock.associate.findUnique.mockResolvedValue(null);
    const r = await setIndividualQuota({ associateId: "a-nonexistent", month: MONTH, amount: 5000 });
    expect(r.ok).toBe(false);
    expect(prismaMock.salesQuota.upsert).toHaveBeenCalledTimes(0);
  });
});

describe("clearIndividualQuota — mirrors clearTeamQuota's shape for the individual row", () => {
  it("an Admin clears an existing individual target and exactly one audit row is written", async () => {
    authMock.mockResolvedValue(ADMIN);
    prismaMock.salesQuota.deleteMany.mockResolvedValue({ count: 1 });
    const r = await clearIndividualQuota({ associateId: TARGET, month: MONTH });
    expect(r.ok).toBe(true);
    expect(prismaMock.salesQuota.deleteMany).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
  });

  it("clearing a target that was never set deletes zero rows and writes no audit row", async () => {
    authMock.mockResolvedValue(ADMIN);
    prismaMock.salesQuota.deleteMany.mockResolvedValue({ count: 0 });
    const r = await clearIndividualQuota({ associateId: TARGET, month: MONTH });
    expect(r.ok).toBe(true);
    expect(logAuditMock).toHaveBeenCalledTimes(0);
  });
});

// T2 — the no-widening proof, against setQuota UNMODIFIED (this test file
// changes nothing in server/quota/actions.ts; the diff for this whole change
// touches zero lines of that file — see the delivery patch). Must be green
// both before this change existed and after.
describe("setQuota (manager path) — still scoped, no widening from this change", () => {
  it("a SalesManager cannot set a target for an associate outside their own team scope", async () => {
    authMock.mockResolvedValue(MANAGER);
    teamScopeIdsMock.mockResolvedValue(["a-manager"]); // scope = self only, target is outside it
    const r = await setQuota({ associateId: TARGET, month: MONTH, amount: 5000 });
    expect(r.ok).toBe(false);
    expect(prismaMock.salesQuota.upsert).toHaveBeenCalledTimes(0);
  });

  it("the same SalesManager CAN set a target for an associate inside their own team scope (control: the guard is real, not always-false)", async () => {
    authMock.mockResolvedValue(MANAGER);
    teamScopeIdsMock.mockResolvedValue(["a-manager", TARGET]); // target now in scope
    const r = await setQuota({ associateId: TARGET, month: MONTH, amount: 5000 });
    expect(r.ok).toBe(true);
    expect(prismaMock.salesQuota.upsert).toHaveBeenCalledTimes(1);
  });
});
