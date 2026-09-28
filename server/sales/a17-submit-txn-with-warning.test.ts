// A-17: the TXN code is assigned at submit regardless of whether the sale
// also comes back with a split-exception warning (B-S6) — the associate
// should see their transaction id either way, per the design note's "TXN
// code shown immediately." Split-bound math has its own tests; this one
// just forces a violation to check the two fields aren't mutually exclusive.
import { describe, it, expect, vi } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    team: { findMany: vi.fn(async () => []) },
    associate: { findUnique: vi.fn(async () => null), count: vi.fn(async () => 1) },
    product: { findMany: vi.fn() },
    salesSubmission: { create: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(async () => [{ nextval: BigInt(42) }]),
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async () => {
  const real = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...real, logAudit: vi.fn() };
});
vi.mock("@/server/commission/split-bounds", () => ({
  splitBoundViolations: vi.fn(async () => [{ productCode: "P1", lineType: "Personal", associateId: "a2", amount: "-50.00" }]),
}));

describe("submitSale — TXN code alongside a split-exception warning", () => {
  it("still returns the transaction code when the closed-deal flag is on and the sale also warns", async () => {
    authMock.mockResolvedValue({ user: { id: "11111111-1111-1111-1111-111111111111", associateId: "22222222-2222-2222-2222-222222222222" } });
    prismaMock.product.findMany.mockResolvedValue([
      { id: "prod1", defaultCompanyId: "co1", productCode: "P1", productName: "Casket", commissionType: "Percentage", isExternal: false, requiresAshesAgreement: false, comCodes: [] },
    ]);
    prismaMock.salesSubmission.create.mockResolvedValue({ id: "sub1" });
    prismaMock.$transaction.mockImplementation(async (fn: (db: typeof prismaMock) => unknown) => fn(prismaMock));

    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    const { submitSale } = await import("./actions");
    const r = await submitSale({
      salesDate: "2026-08-01", clientName: "Warned Client", paymentPlan: "Full Payment",
      lines: [{ productId: "prod1", lineSaleAmount: 1000, comCodeIds: [] }],
      associate2: { associateId: "33333333-3333-3333-3333-333333333333", valueType: "Absolute", value: 5000 },
    });
    delete process.env.A17_CLOSED_DEAL_FLOW;

    expect(r.ok).toBe(true);
    expect(r.warning?.code).toBe("splitExceedsNet");
    expect(r.transactionCode).toBe("TXN-0042");
  }, 15_000); // vi.resetModules() + a fresh dynamic import of the whole action graph is slow, not hung
});
