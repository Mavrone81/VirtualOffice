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
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));
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

  it("returns the CSV on the correct password; the audit is written inside the build (Tier A), not after", async () => {
    state.reauthOk = true;
    const r = await generateBankFile("2026-07", "correct");
    expect(r).toEqual({ ok: true, csv: "CSVDATA", batchId: "b1", reprint: false });
    expect(buildBankFileCsv).toHaveBeenCalledWith("2026-07", "admin1", { batchId: undefined });
    // M5's audit (batch + exact payout ids) now commits with the batch stamp in
    // buildBankFileCsv (server/audit-before-reveal.integration.test.ts), never best-effort after.
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("no audit record → no file: an audit failure is a clean 'auditUnavailable'", async () => {
    state.reauthOk = true;
    const { AuditWriteError } = await import("@/lib/audit");
    vi.mocked(buildBankFileCsv).mockRejectedValueOnce(new AuditWriteError("payout.bankfile_generated", new Error("x")));
    expect(await generateBankFile("2026-07", "correct")).toEqual({ ok: false, error: "auditUnavailable" });
  });
});
