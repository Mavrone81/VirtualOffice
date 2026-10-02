import { describe, it, expect, vi, beforeEach } from "vitest";

// U1 sweep: the other two cookie-authenticated POST route handlers (the admin AI
// assistant and the referral-agreement PDF preview) get the same Origin check as
// the bank-file route. Real handlers; the
// session, the Anthropic client, the snapshot and the PDF renderer are mocked.

const state = { session: { user: { role: "Admin", associateId: null } } as unknown };

vi.mock("@/auth", () => ({ auth: vi.fn(async () => state.session) }));
vi.mock("@/lib/rbac", () => ({ isFullAdmin: () => true }));
vi.mock("@/lib/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_MODEL: "test-model" } }));
vi.mock("@/server/assistant/system-context", () => ({ buildSystemContext: vi.fn(async () => "SNAPSHOT") }));
const stream = vi.fn(() => ({
  on: (_e: string, cb: (t: string) => void) => cb("hello"),
  finalMessage: async () => ({}),
}));
vi.mock("@anthropic-ai/sdk", () => ({ default: vi.fn(function () { return { messages: { stream } }; }) }));
vi.mock("@/lib/pdf/referral-agreement", () => ({ renderReferralAgreementPdfFromData: vi.fn(async () => Buffer.from("%PDF-1.4")) }));

import { POST as assistant } from "@/app/api/assistant/route";
import { POST as preview } from "@/app/portal/referrals/preview/route";
import { auth } from "@/auth";
import { renderReferralAgreementPdfFromData } from "@/lib/pdf/referral-agreement";

beforeEach(() => vi.clearAllMocks());

const SAME = { host: "vo.example.com", origin: "https://vo.example.com" };
const FOREIGN = { host: "vo.example.com", origin: "https://evil.example.net" };

function askAssistant(headers: Record<string, string>) {
  return assistant(new Request("https://vo.example.com/api/assistant", {
    method: "POST", headers: { "content-type": "text/plain", ...headers },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  }));
}
function askPreview(headers: Record<string, string>) {
  const body = new FormData();
  body.set("vendorName", "Demo Vendor Pte Ltd");
  return preview(new Request("https://vo.example.com/portal/referrals/preview", { method: "POST", body, headers }));
}

describe("assistant POST Origin check", () => {
  it("foreign / missing Origin → 403 before auth, and no Anthropic call", async () => {
    expect((await askAssistant(FOREIGN)).status).toBe(403);
    expect((await askAssistant({ host: "vo.example.com" })).status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });
  it("same-origin → streams the reply", async () => {
    const res = await askAssistant(SAME);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(stream).toHaveBeenCalledOnce();
  });
});

describe("assistant POST mustResetPassword check (#29)", () => {
  // middleware.ts excludes /api/* entirely, so the force-reset page redirect
  // never applies here — this route must check the flag itself.
  it("refuses an admin session with mustResetPassword still set, no Anthropic call", async () => {
    state.session = { user: { role: "Admin", associateId: null, mustResetPassword: true } };
    expect((await askAssistant(SAME)).status).toBe(403);
    expect(stream).not.toHaveBeenCalled();
  });
  it("positive control: the same caller streams once mustResetPassword is false", async () => {
    state.session = { user: { role: "Admin", associateId: null, mustResetPassword: false } };
    expect((await askAssistant(SAME)).status).toBe(200);
  });
});

describe("referral preview POST Origin check", () => {
  it("foreign / missing Origin → 403, nothing rendered", async () => {
    expect((await askPreview(FOREIGN)).status).toBe(403);
    expect((await askPreview({ host: "vo.example.com" })).status).toBe(403);
    expect(renderReferralAgreementPdfFromData).not.toHaveBeenCalled();
  });
  it("same-origin → the PDF", async () => {
    const res = await askPreview(SAME);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(renderReferralAgreementPdfFromData).toHaveBeenCalledOnce();
  });
});
