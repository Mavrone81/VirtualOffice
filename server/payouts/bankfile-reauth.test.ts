import { describe, it, expect, vi, beforeEach } from "vitest";

// reauth result is toggled per-test; the closure reads it at call time.
const state = { reauthOk: false };

vi.mock("@/server/access", () => ({
  getAdminPrincipal: async () => ({ userId: "admin1", role: "Admin" }),
}));
vi.mock("@/lib/reauth", () => ({ reauth: vi.fn(async () => state.reauthOk) }));
vi.mock("@/server/payouts/bankfile", () => ({ buildBankFileCsv: vi.fn(async () => "CSVDATA") }));
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
    expect(r).toEqual({ ok: true, csv: "CSVDATA" });
    expect(buildBankFileCsv).toHaveBeenCalledWith("2026-07", "admin1");
    expect(logAudit).toHaveBeenCalledOnce();
  });
});
