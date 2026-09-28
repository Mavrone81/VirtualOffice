// MD B3 counterpart (AD, 28 Sep): the sibling money-binding integration test
// (a17-b3-money-binding.integration.test.ts) is pinned flag-OFF — correct,
// since it's flow=Legacy and N4 would otherwise refuse the very sign call it
// proves. But that leaves B3 completely untested in the configuration it
// will actually run in once the flag flips: in flag-ON production, B3's
// refresh can only ever reach flow=ClosedDeal rows (N4 refuses every Legacy
// sign). This file proves the SAME refresh on a ClosedDeal row, with the
// flag genuinely on. Real throwaway Postgres; fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";

const TAG = "A17B3CD-";
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const SIGNATURE_DATA_URL = `data:image/png;base64,${PNG_B64}`;
let closerId = "";

beforeAll(async () => {
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});
afterEach(async () => {
  who.session = null;
  delete process.env.A17_CLOSED_DEAL_FLOW;
});
afterAll(async () => {
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: closerId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  await prisma.petsAshesAgreement.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
});

async function mkSignedThenRevertedClosedDealSubmission(code: string) {
  // flow=ClosedDeal, editable status = Submitted (isAgreementEditableStatus).
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2098-09-02"), clientName: TAG + code, saleAmount: "1000", paymentPlan: "FullPayment",
      closingAssociateId: closerId, status: "Submitted", flow: "ClosedDeal", transactionCode: TAG + code,
    },
    select: { id: true },
  });
  const agreement = await prisma.petsAshesAgreement.create({
    data: {
      submissionId: sub.id, applicant1Name: TAG + "Applicant", applicant1Nric: "S1111111A",
      amountNumeric: "1000.00", amountWords: "One thousand dollars", paymentPlan: "FullPayment",
    },
    select: { id: true },
  });
  // Same simulated history as the Legacy sibling test: signed once at 1000,
  // then an edit raised saleAmount to 1800 and reverted the agreement to
  // Draft, clearing only the signed-* columns — amountNumeric/amountWords
  // deliberately left stale.
  await prisma.salesSubmission.update({ where: { id: sub.id }, data: { saleAmount: "1800" } });
  return { submissionId: sub.id, agreementId: agreement.id };
}

describe("B3 (ClosedDeal, flag genuinely ON): signAshesAgreement refreshes stale money fields at sign time", () => {
  it("refreshes amountNumeric/amountWords/etc. for a ClosedDeal row too, not just Legacy", async () => {
    const { submissionId, agreementId } = await mkSignedThenRevertedClosedDealSubmission("F1");
    who.session = { user: { associateId: closerId, id: closerId } };
    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    const { signAshesAgreement } = (await import("./actions")) as {
      signAshesAgreement: (id: string, dataUrl: string) => Promise<{ ok: boolean; error?: string }>;
    };
    const r = await signAshesAgreement(submissionId, SIGNATURE_DATA_URL);
    expect(r.ok).toBe(true);
    const signed = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(signed.status).toBe("Signed");
    expect(signed.amountNumeric.toFixed(2)).toBe("1800.00");
    expect(signed.amountWords).not.toBe("One thousand dollars");
    expect((signed.signedTerms as { saleAmount?: string } | null)?.saleAmount).toBe("1800.00");
  });
});
