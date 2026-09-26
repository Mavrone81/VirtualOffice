import { describe, it, expect, vi, beforeEach } from "vitest";

// reauth result is toggled per-test; the closure reads it at call time.
const state = { reauthOk: false };

vi.mock("@/server/access", () => ({
  getAdminPrincipal: async () => ({ userId: "admin1", role: "Admin" }),
}));
vi.mock("@/lib/reauth", () => ({ reauth: vi.fn(async () => state.reauthOk) }));
vi.mock("@/server/payouts/bankfile", () => ({
  buildBankFileCsv: vi.fn(async () => ({ csv: "CSVDATA", batchId: "b1", payoutIds: ["p1"], total: "100.00" })),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { generateBankFile } from "./actions";
import { buildBankFileCsv } from "@/server/payouts/bankfile";
import { logAudit } from "@/lib/audit";

beforeEach(() => vi.clearAllMocks());

describe("generateBankFile reauth gate", () => {
  it("rejects a bad password: no CSV build, no audit", async () => {
    state.reauthOk = false;
    const r = await generateBankFile("2026-07", "wrong");
    expect(r).toEqual({ ok: false, error: "reauthFailed" });
    expect(buildBankFileCsv).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("returns the CSV and writes an audit row on the correct password", async () => {
    state.reauthOk = true;
    const r = await generateBankFile("2026-07", "correct");
    expect(r).toEqual({ ok: true, csv: "CSVDATA", batchId: "b1", reprint: false });
    expect(buildBankFileCsv).toHaveBeenCalledWith("2026-07", "admin1", { batchId: undefined });
    expect(logAudit).toHaveBeenCalledOnce();
    // M5: the audit names the batch and exactly which payouts were exported.
    expect(vi.mocked(logAudit).mock.calls[0][0]).toMatchObject({
      action: "payout.bankfile_generated", entityId: "b1", after: { month: "2026-07", batchId: "b1", payoutIds: ["p1"], total: "100.00" },
    });
  });
});
