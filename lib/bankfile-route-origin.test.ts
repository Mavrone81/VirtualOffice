import { describe, it, expect, vi, beforeEach } from "vitest";

// U1 regression: POST /admin/payouts/bank-file is a cookie-authenticated route
// handler, so it needs its own Origin (CSRF) check. Lives under lib/ so the vitest
// include picks it up; exercises the real route handler with generateBankFile mocked.

vi.mock("@/server/payouts/actions", () => ({
  generateBankFile: vi.fn(async () => ({ ok: true, csv: "CSVDATA", batchId: "b1b1b1b1-0000", reprint: false })),
}));

import { POST } from "@/app/admin/payouts/bank-file/route";
import { generateBankFile } from "@/server/payouts/actions";
import { isSameOrigin } from "./same-origin";

beforeEach(() => vi.clearAllMocks());

function post(headers: Record<string, string>) {
  const body = new FormData();
  body.set("month", "2026-07");
  body.set("password", "pw");
  return POST(new Request("http://vo.example.com/admin/payouts/bank-file", { method: "POST", body, headers }) as never);
}

describe("bank-file POST Origin check", () => {
  it("rejects a foreign Origin with 403, before generateBankFile (no reauth attempt)", async () => {
    const res = await post({ host: "vo.example.com", origin: "https://evil.example.net" });
    expect(res.status).toBe(403);
    expect(generateBankFile).not.toHaveBeenCalled();
  });

  it("rejects a missing Origin and the literal 'null' Origin", async () => {
    expect((await post({ host: "vo.example.com" })).status).toBe(403);
    expect((await post({ host: "vo.example.com", origin: "null" })).status).toBe(403);
    expect(generateBankFile).not.toHaveBeenCalled();
  });

  it("rejects a look-alike host (suffix / port mismatch)", async () => {
    expect((await post({ host: "vo.example.com", origin: "https://vo.example.com.evil.net" })).status).toBe(403);
    expect((await post({ host: "vo.example.com", origin: "https://vo.example.com:8443" })).status).toBe(403);
    expect(generateBankFile).not.toHaveBeenCalled();
  });

  it("serves the CSV for a same-origin POST", async () => {
    const res = await post({ host: "vo.example.com", origin: "https://vo.example.com" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("CSVDATA");
    expect(generateBankFile).toHaveBeenCalledWith("2026-07", "pw", undefined);
  });

  it("uses x-forwarded-host (behind the reverse proxy), like Next's server-action check", async () => {
    const ok = await post({ host: "127.0.0.1:10502", "x-forwarded-host": "vo.example.com", origin: "https://vo.example.com" });
    expect(ok.status).toBe(200);
    const bad = await post({ host: "vo.example.com", "x-forwarded-host": "vo.example.com", origin: "https://evil.example.net" });
    expect(bad.status).toBe(403);
  });
});

describe("isSameOrigin", () => {
  const req = (h: Record<string, string>) => new Request("http://x/", { method: "POST", headers: h });
  it("is case-insensitive on host and ignores scheme", () => {
    expect(isSameOrigin(req({ host: "VO.example.com", origin: "http://vo.EXAMPLE.com" }))).toBe(true);
  });
  it("fails closed without a host", () => {
    expect(isSameOrigin(req({ origin: "https://vo.example.com" }))).toBe(false);
  });
});
