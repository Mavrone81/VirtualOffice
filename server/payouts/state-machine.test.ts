import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
const payout = { current: "Paid" as string, updatedCount: 1, total: "100" };
// B-7: setPayoutStatus now runs inside prisma.$transaction (locking every
// sales_transaction this payout's lines belong to first). `tx` IS the same
// mock object as `prisma` here — a Prisma.TransactionClient has the same
// model-delegate shape as PrismaClient, so existing assertions against
// prisma.monthlyPayout.updateMany still see the calls made via `db`.
vi.mock("@/lib/db", () => {
  const prismaMock = {
    monthlyPayout: {
      findUnique: vi.fn(async () => ({ id: "p1", payoutStatus: payout.current, totalPayable: new Prisma.Decimal(payout.total) })),
      updateMany: vi.fn(async () => ({ count: payout.updatedCount })),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (db: unknown) => unknown) => fn(prismaMock)),
  };
  return { prisma: prismaMock };
});
vi.mock("@/server/access", () => ({ getAdminPrincipal: async () => ({ userId: "u1", role: "Admin" }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));
import { setPayoutStatus } from "./actions";
import { prisma } from "@/lib/db";
beforeEach(() => { vi.clearAllMocks(); payout.updatedCount = 1; payout.total = "100"; });
describe("setPayoutStatus state machine", () => {
  it("rejects transition out of Paid (terminal) and does not update", async () => {
    payout.current = "Paid";
    const r = await setPayoutStatus("p1", "Approved");
    expect(r).toEqual({ ok: false, error: "illegalPayoutTransition" });
    expect(prisma.monthlyPayout.updateMany).not.toHaveBeenCalled();
  });
  it("allows Approved -> Paid", async () => {
    payout.current = "Approved";
    const r = await setPayoutStatus("p1", "Paid");
    expect(r.ok).toBe(true);
    expect(prisma.monthlyPayout.updateMany).toHaveBeenCalledOnce();
  });
  it("rejects Pending -> Paid (must go via Approved)", async () => {
    payout.current = "Pending";
    const r = await setPayoutStatus("p1", "Paid");
    expect(r).toEqual({ ok: false, error: "illegalPayoutTransition" });
  });
  it("rejects when a concurrent transition already moved the row (compare-and-swap misses)", async () => {
    // Passes the in-memory guard (read says Approved) but the atomic
    // updateMany matches 0 rows because another writer got there first.
    payout.current = "Approved";
    payout.updatedCount = 0;
    const r = await setPayoutStatus("p1", "Paid");
    expect(r).toEqual({ ok: false, error: "illegalPayoutTransition" });
  });
  it("refuses to approve a payout whose total is zero or less (M5)", async () => {
    payout.current = "Pending";
    payout.total = "-296";
    expect(await setPayoutStatus("p1", "Approved")).toEqual({ ok: false, error: "payoutNotPositive" });
    payout.total = "0";
    expect(await setPayoutStatus("p1", "Approved")).toEqual({ ok: false, error: "payoutNotPositive" });
    expect(prisma.monthlyPayout.updateMany).not.toHaveBeenCalled();
  });
  it("compares the total it checked, and audits actor + amounts (C2/C3)", async () => {
    payout.current = "Approved";
    const r = await setPayoutStatus("p1", "Paid");
    expect(r.ok).toBe(true);
    expect(vi.mocked(prisma.monthlyPayout.updateMany).mock.calls[0][0]).toMatchObject({
      where: { id: "p1", payoutStatus: "Approved", totalPayable: new Prisma.Decimal("100") },
    });
    const { auditTx } = await import("@/lib/audit");
    expect(vi.mocked(auditTx).mock.calls[0][1]).toMatchObject({ // Tier A: recorded inside the transition's transaction
      action: "payout.Paid", actorUserId: "u1",
      before: { status: "Approved", total: "100.00" }, after: { status: "Paid", total: "100.00" },
    });
  });
});
