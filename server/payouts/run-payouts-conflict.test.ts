// M5 conflict paths of runPayouts, driven deterministically with a mocked db:
// a payout that leaves Pending mid-run (compare-and-swap miss), and a concurrent
// run that created the same seq first (P2002). Real concurrency against Postgres
// is covered in m5-concurrency.integration.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const assoc = (id: string) => ({ id, fullName: id, designation: "SalesAssociate", paymentMethod: null, paynowNumber: null, bankName: null, bankAccountNumber: null });
const line = (id: string, associateId: string, amount: string) =>
  ({ id, associateId, associate: assoc(associateId), lineType: "Personal", amount: new Prisma.Decimal(amount) });

// Per-associate script for what the db "sees" inside that associate's transaction.
type Script = { latest: unknown; statusAtRecompute: string; casCount: number; createThrows?: unknown };
const state: { scripts: Record<string, Script>; current: string } = { scripts: {}, current: "" };

const db = {
  monthlyPayout: {
    findFirst: vi.fn(async () => state.scripts[state.current].latest),
    create: vi.fn(async () => {
      const s = state.scripts[state.current];
      if (s.createThrows) throw s.createThrows;
      return { id: `new-${state.current}` };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
      id: where.id, payoutStatus: state.scripts[state.current].statusAtRecompute,
      personalCommission: new Prisma.Decimal(0), overrideCommission: new Prisma.Decimal(0),
      addonCommission: new Prisma.Decimal(0), totalPayable: new Prisma.Decimal(0),
    })),
    updateMany: vi.fn(async () => ({ count: state.scripts[state.current].casCount })),
  },
  commissionLedger: {
    updateMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length })),
    findMany: vi.fn(async () => [{ lineType: "Personal", amount: new Prisma.Decimal("100") }]),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    monthlyPayout: { count: vi.fn(async () => 0) },
    commissionLedger: { findMany: vi.fn(async () => [line("l1", "a1", "100"), line("l2", "a2", "100")]) },
    $transaction: vi.fn(async (fn: (d: typeof db) => unknown) => {
      // Each associate's step runs in its own transaction, in line order: a1 then a2.
      state.current = state.current === "" ? "a1" : "a2";
      return fn(db);
    }),
  },
}));
vi.mock("@/server/access", () => ({ getAdminPrincipal: async () => ({ userId: "admin1", role: "Admin" }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/reauth", () => ({ reauth: vi.fn() }));
vi.mock("@/server/payouts/bankfile", () => ({ buildBankFileCsv: vi.fn() }));

import { runPayouts } from "./actions";
import { logAudit } from "@/lib/audit";

const ok: Script = { latest: null, statusAtRecompute: "Pending", casCount: 1 };
const audited = () => vi.mocked(logAudit).mock.calls.map(([a]) => a);

beforeEach(() => {
  vi.clearAllMocks();
  state.current = "";
});

describe("runPayouts conflict paths (M5)", () => {
  it("the happy path writes and audits both associates", async () => {
    state.scripts = { a1: ok, a2: ok };
    expect(await runPayouts("2099-05")).toEqual({ ok: true, count: 2 });
    expect(audited().map((a) => a.action)).toEqual(["payout.created", "payout.created", "payouts.run"]);
  });

  it("a Pending payout approved between read and write: CAS misses, run stops, nothing is written to it", async () => {
    // a2's Pending payout is approved by someone else after runPayouts read it.
    const pending = { id: "p2", seq: 0, payoutStatus: "Pending" };
    state.scripts = { a1: ok, a2: { latest: pending, statusAtRecompute: "Pending", casCount: 0 } };
    expect(await runPayouts("2099-05")).toEqual({ ok: false, error: "payoutRunConflict" });
    // a1 committed and is audited; the run is marked interrupted; no entry for p2.
    expect(audited().map((a) => a.action)).toEqual(["payout.created", "payouts.run"]);
    expect(audited()[1].after).toMatchObject({ count: 1, interrupted: true });
    expect(audited().some((a) => a.entityId === "p2")).toBe(false);
  });

  it("a payout that is already non-Pending when totals are re-derived: no write at all", async () => {
    const pending = { id: "p2", seq: 0, payoutStatus: "Pending" };
    state.scripts = { a1: ok, a2: { latest: pending, statusAtRecompute: "Approved", casCount: 1 } };
    expect(await runPayouts("2099-05")).toEqual({ ok: false, error: "payoutRunConflict" });
    // recomputePendingPayout bailed before its updateMany: only a1's CAS write happened.
    expect(db.monthlyPayout.updateMany).toHaveBeenCalledTimes(1);
  });

  it("a concurrent run created the same seq first (P2002): reported as a conflict, not a crash", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" });
    state.scripts = { a1: ok, a2: { ...ok, createThrows: p2002 } };
    expect(await runPayouts("2099-05")).toEqual({ ok: false, error: "payoutRunConflict" });
    expect(audited().at(-1)?.after).toMatchObject({ count: 1, interrupted: true });
  });

  it("any other database error still propagates", async () => {
    state.scripts = { a1: { ...ok, createThrows: new Error("connection lost") }, a2: ok };
    await expect(runPayouts("2099-05")).rejects.toThrow("connection lost");
  });
});
