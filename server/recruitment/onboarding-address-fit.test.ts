import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, rateLimitMock, wouldTruncateMock } = vi.hoisted(() => {
  return {
    prismaMock: {
      candidate: {
        findUnique: vi.fn(),
      },
    },
    rateLimitMock: {
      checkRateLimit: vi.fn(),
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    },
    wouldTruncateMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/rate-limit", () => rateLimitMock);
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({ putObject: vi.fn(), getObject: vi.fn() }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(), onboardingInviteEmail: vi.fn(), approvalEmail: vi.fn() }));
vi.mock("@/lib/pdf/agreement", () => ({
  renderAgreementPdf: vi.fn(async () => Buffer.from("pdf")),
  formatUplineOrNA: () => "NA",
  wouldTruncate: wouldTruncateMock,
}));

import { homeAddressWouldTruncate } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.checkRateLimit.mockResolvedValue({ allowed: true });
  prismaMock.candidate.findUnique.mockResolvedValue({
    id: "c1",
    onboardingStage: "Invited",
  });
  wouldTruncateMock.mockResolvedValue(false);
});

describe("homeAddressWouldTruncate — token gating (item 5)", () => {
  it("checks the rate limit keyed by the onboarding token, on its own bucket", async () => {
    await homeAddressWouldTruncate("tok-abc", "1 Test Street");

    expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith("tok-abc", "onboard_check_address");
  });

  it("is refused (true, fail-closed) and never measures when rate-limited", async () => {
    rateLimitMock.checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSec: 900 });

    const r = await homeAddressWouldTruncate("tok123", "1 Test Street");

    expect(r).toBe(true);
    expect(prismaMock.candidate.findUnique).not.toHaveBeenCalled();
    expect(wouldTruncateMock).not.toHaveBeenCalled();
  });

  it("is refused (true, fail-closed) for an absent token, and records the failure", async () => {
    prismaMock.candidate.findUnique.mockResolvedValue(null);

    const r = await homeAddressWouldTruncate("tok-missing", "1 Test Street");

    expect(r).toBe(true);
    expect(rateLimitMock.recordFailure).toHaveBeenCalledWith("tok-missing", "onboard_check_address");
    expect(wouldTruncateMock).not.toHaveBeenCalled();
  });

  it("is refused (true, fail-closed) for an invalid token string, not just a missing one", async () => {
    prismaMock.candidate.findUnique.mockResolvedValue(null);

    const r = await homeAddressWouldTruncate("not-a-real-token", "1 Test Street");

    expect(r).toBe(true);
    expect(wouldTruncateMock).not.toHaveBeenCalled();
  });

  it("is refused for a candidate already past onboarding (Approved)", async () => {
    prismaMock.candidate.findUnique.mockResolvedValue({ id: "c1", onboardingStage: "Approved" });

    const r = await homeAddressWouldTruncate("tok-done", "1 Test Street");

    expect(r).toBe(true);
    expect(rateLimitMock.recordFailure).toHaveBeenCalledWith("tok-done", "onboard_check_address");
    expect(wouldTruncateMock).not.toHaveBeenCalled();
  });

  it("is refused for a candidate already past onboarding (Rejected)", async () => {
    prismaMock.candidate.findUnique.mockResolvedValue({ id: "c1", onboardingStage: "Rejected" });

    const r = await homeAddressWouldTruncate("tok-rejected", "1 Test Street");

    expect(r).toBe(true);
    expect(wouldTruncateMock).not.toHaveBeenCalled();
  });

  it("rejects a value over the schema's own max(500) BEFORE calling the measurer", async () => {
    const overLong = "A".repeat(501);

    const r = await homeAddressWouldTruncate("tok-ok", overLong);

    expect(r).toBe(true);
    expect(wouldTruncateMock).not.toHaveBeenCalled();
  });

  it("passes exactly 500 chars through to the measurer (not rejected at the bound itself)", async () => {
    const exactly500 = "A".repeat(500);

    await homeAddressWouldTruncate("tok-ok", exactly500);

    expect(wouldTruncateMock).toHaveBeenCalledWith(exactly500);
  });

  it("delegates to the shared measurer for a valid token and in-range value, and returns its verdict", async () => {
    wouldTruncateMock.mockResolvedValue(false);
    const r1 = await homeAddressWouldTruncate("tok-ok", "1 Test Street");
    expect(r1).toBe(false);

    wouldTruncateMock.mockResolvedValue(true);
    const r2 = await homeAddressWouldTruncate("tok-ok", "a much longer address than the box can hold");
    expect(r2).toBe(true);
  });

  it("does not record a failure on a verified, in-range check", async () => {
    await homeAddressWouldTruncate("tok-ok", "1 Test Street");

    expect(rateLimitMock.recordFailure).not.toHaveBeenCalled();
  });
});
