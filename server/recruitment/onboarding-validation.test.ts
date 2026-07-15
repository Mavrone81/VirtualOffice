import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, putObjectMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shared mock is reused for both a throwing and a resolving case
  const throwOnTouch = (label: string) => vi.fn<(...args: any[]) => any>(() => { throw new Error(`${label} must not be touched on invalid input`); });
  return {
    prismaMock: {
      candidate: {
        findUnique: vi.fn(),
        update: throwOnTouch("Candidate write"),
      },
      associate: {
        findUnique: vi.fn(),
      },
    },
    putObjectMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  putObject: putObjectMock,
  getObject: vi.fn(),
  imageExt: vi.fn(() => "jpg"),
}));
vi.mock("@/lib/pdf/agreement", () => ({ renderAgreementPdf: vi.fn(async () => Buffer.from("pdf")) }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(), onboardingInviteEmail: vi.fn(), approvalEmail: vi.fn() }));

import { submitOnboarding } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.candidate.findUnique.mockResolvedValue({
    id: "c1",
    onboardingStage: "Invited",
    photoFileKey: null,
    signedAgreementFileKey: null,
    intendedDirectUplineId: null,
    intendedDesignation: "SalesConsultant",
    fullName: "Jane Tan",
    email: "jane@example.com",
    mobileNumber: "91234567",
    intendedTeam: null,
  });
  putObjectMock.mockResolvedValue(undefined);
});

describe("submitOnboarding validation", () => {
  it("returns invalidInput and never writes to the DB or object storage for malformed input", async () => {
    // Otherwise well-formed submission (passes the pre-existing ad-hoc field
    // checks: nric present, agreementAccepted true, signature present) but
    // paymentMethod is outside the enum — only schema validation catches this.
    const malformed = {
      nric: "S1234567A",
      paymentMethod: "Crypto",
      agreementAccepted: true,
      signature: "data:image/png;base64,abc",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed input, per Task 3 brief Step 1
    } as any;
    const r = await submitOnboarding("tok123", malformed);

    expect(r).toEqual({ ok: false, error: "invalidInput" });
    expect(prismaMock.candidate.update).not.toHaveBeenCalled();
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("does not reject cleared optional fields sent as empty strings (form clears to '', not undefined)", async () => {
    prismaMock.candidate.update.mockResolvedValue({});
    const r = await submitOnboarding("tok123", {
      nric: "S1234567A",
      paymentMethod: "PayNow",
      agreementAccepted: true,
      signature: "data:image/png;base64,abc",
      dateOfBirth: "",
      bankAccountNumber: "",
    });
    expect(r).toEqual({ ok: true });
  });
});
