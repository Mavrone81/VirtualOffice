// MD B3 (A-17 must-fix before merge): signedTerms is computed fresh from the
// live submission at sign time, but the rendered PDF (lib/pdf/ashes-agreement.tsx)
// reads amountNumeric/amountWords/paymentPlan/bookingFee/monthlyInstalment
// from the AGREEMENT ROW — fields editSale's void-to-Draft reversion never
// refreshes (it only clears the signed-* columns). A Draft reverted after a
// money edit could be re-signed with a PDF showing the OLD amount while
// signedTerms (and therefore G3b's drift check) shows no drift at all,
// because it's computed from the submission, not these columns. Seen-failing:
// proves the pre-fix code signs a stale-amount PDF; the fix refreshes these
// fields in the same CAS update that flips to Signed. Real throwaway
// Postgres; fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
// A-17 follow-up (ambient-flag release blocker): this fixture is flow=Legacy
// (an arbitrary, simpler-precondition choice — the fix under test doesn't
// depend on flow at all), but N4's Legacy-frozen check is reachable under
// ambient A17_CLOSED_DEAL_FLOW=true and would refuse the very sign call this
// test is proving. Forced off so this file (about the money-refresh fix, not
// about N4) isn't steered by ambient config either way.
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), env: { ...(await orig<typeof import("@/lib/env")>()).env, A17_CLOSED_DEAL_FLOW: false } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";

const TAG = "A17B3-";
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const SIGNATURE_DATA_URL = `data:image/png;base64,${PNG_B64}`;
let closerId = "";

beforeAll(async () => {
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});
afterEach(() => { who.session = null; });
afterAll(async () => {
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: closerId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  await prisma.petsAshesAgreement.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
});

async function mkSignedThenRevertedSubmission(code: string) {
  // flow=Legacy, editable status = QuotationApproved (isAgreementEditableStatus).
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2098-09-01"), clientName: TAG + code, saleAmount: "1000", paymentPlan: "FullPayment",
      closingAssociateId: closerId, status: "QuotationApproved", flow: "Legacy",
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
  // Simulate: signed once at 1000, then editSale (a) raised saleAmount to
  // 1800 and (b) reverted the agreement to Draft — clearing ONLY the
  // signed-* columns, exactly as editSale's own code does (server/sales/
  // actions.ts). amountNumeric/amountWords are deliberately left stale here,
  // matching what editSale actually leaves behind.
  await prisma.salesSubmission.update({ where: { id: sub.id }, data: { saleAmount: "1800" } });
  return { submissionId: sub.id, agreementId: agreement.id };
}

describe("B3: signAshesAgreement refreshes stale money fields at sign time", () => {
  it("pre-fix would sign a stale-amount PDF; the fix refreshes amountNumeric/amountWords/etc. first", async () => {
    const { submissionId, agreementId } = await mkSignedThenRevertedSubmission("F1");
    who.session = { user: { associateId: closerId, id: closerId } };
    vi.resetModules();
    const { signAshesAgreement } = (await import("./actions")) as {
      signAshesAgreement: (id: string, dataUrl: string) => Promise<{ ok: boolean; error?: string }>;
    };
    const r = await signAshesAgreement(submissionId, SIGNATURE_DATA_URL);
    expect(r.ok).toBe(true);
    const signed = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(signed.status).toBe("Signed");
    // The bug this closes: the row's own money fields must match the CURRENT
    // submission (1800), not whatever they were left at (1000) — a signed
    // PDF is rendered straight from these columns (lib/pdf/ashes-agreement.tsx).
    expect(signed.amountNumeric.toFixed(2)).toBe("1800.00");
    expect(signed.amountWords).not.toBe("One thousand dollars");
    // And signedTerms (the drift-check snapshot) must agree with the SAME
    // amount — the two must never be able to disagree.
    expect((signed.signedTerms as { saleAmount?: string } | null)?.saleAmount).toBe("1800.00");
  });
});
