import { describe, it, expect, vi, beforeEach } from "vitest";
const payout = { current: "Paid" as string };
vi.mock("@/lib/db", () => ({ prisma: {
  monthlyPayout: {
    findUnique: vi.fn(async () => ({ id: "p1", payoutStatus: payout.current })),
    update: vi.fn(async () => ({ id: "p1" })),
  },
}}));
vi.mock("@/server/access", () => ({ getAdminPrincipal: async () => ({ userId: "u1", role: "Admin" }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
import { setPayoutStatus } from "./actions";
import { prisma } from "@/lib/db";
beforeEach(() => vi.clearAllMocks());
describe("setPayoutStatus state machine", () => {
  it("rejects transition out of Paid (terminal) and does not update", async () => {
    payout.current = "Paid";
    const r = await setPayoutStatus("p1", "Approved");
    expect(r).toEqual({ ok: false, error: "illegalPayoutTransition" });
    expect(prisma.monthlyPayout.update).not.toHaveBeenCalled();
  });
  it("allows Approved -> Paid", async () => {
    payout.current = "Approved";
    const r = await setPayoutStatus("p1", "Paid");
    expect(r.ok).toBe(true);
    expect(prisma.monthlyPayout.update).toHaveBeenCalledOnce();
  });
  it("rejects Pending -> Paid (must go via Approved)", async () => {
    payout.current = "Pending";
    const r = await setPayoutStatus("p1", "Paid");
    expect(r).toEqual({ ok: false, error: "illegalPayoutTransition" });
  });
});
