// N4 (A-17, scoped to the two real gaps only — approveQuotation/closeSale/
// split approvals are UNCHANGED, per the already-reviewed design in
// reviews/a17-flag-on-preconditions.md §3): saveAshesAgreement,
// signAshesAgreement and uploadDocketDocuments had ZERO flag-tied Legacy
// protection — a Legacy row's ashes agreement stayed editable/signable, and
// its docket stayed uploadable, indefinitely after the flag flips on, which
// contradicts the "frozen — no edit at all" design intent (the same intent
// editSale/rejectSubmission already enforce). Seen-failing: each test
// proves the pre-fix code lets the call through on a flow=Legacy row with
// the flag on, before showing the fix refuses it. Real throwaway Postgres;
// fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";

const TAG = "A17N4-";
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
  await prisma.submissionDocument.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  // audit_log is append-only by DDL trigger (main's own audit-append-only
  // migration) — a DELETE is refused, and refused-by-design, not a compromise
  // (main's own pre-existing audit-*.integration.test.ts files have zero
  // auditLog deletes for the same reason). Left in place, not cleaned up.
});

async function mkLegacySubmission(code: string) {
  const sub = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2098-10-01"), clientName: TAG + code, saleAmount: "1000", paymentPlan: "FullPayment",
      closingAssociateId: closerId, status: "QuotationApproved", flow: "Legacy",
    },
    select: { id: true },
  });
  return sub.id;
}

describe("N4: saveAshesAgreement refuses a Legacy row once the flag is on", () => {
  it("pre-fix would save real application details; the fix refuses", async () => {
    const submissionId = await mkLegacySubmission("SAA1");
    who.session = { user: { associateId: closerId, id: closerId } };
    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    const { saveAshesAgreement } = (await import("./actions")) as {
      saveAshesAgreement: (id: string, input: unknown) => Promise<{ ok: boolean; error?: string; id?: string }>;
    };
    const r = await saveAshesAgreement(submissionId, { applicant1Name: TAG + "Applicant", pets: [] });
    expect(r).toEqual({ ok: false, error: "legacyReadOnly" });
    expect(await prisma.petsAshesAgreement.count({ where: { submissionId } })).toBe(0);
  });
});

describe("N4: signAshesAgreement refuses a Legacy row once the flag is on", () => {
  it("pre-fix would sign a real agreement; the fix refuses", async () => {
    const submissionId = await mkLegacySubmission("SIA1");
    await prisma.petsAshesAgreement.create({
      data: { submissionId, applicant1Name: TAG + "Applicant", applicant1Nric: "S1111111A", amountNumeric: "1000.00", amountWords: "One thousand dollars", paymentPlan: "FullPayment" },
    });
    who.session = { user: { associateId: closerId, id: closerId } };
    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    const { signAshesAgreement } = (await import("./actions")) as {
      signAshesAgreement: (id: string, dataUrl: string) => Promise<{ ok: boolean; error?: string }>;
    };
    const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const r = await signAshesAgreement(submissionId, `data:image/png;base64,${PNG_B64}`);
    expect(r).toEqual({ ok: false, error: "legacyReadOnly" });
    expect((await prisma.petsAshesAgreement.findFirstOrThrow({ where: { submissionId } })).status).toBe("Draft");
  });
});

describe("N4: uploadDocketDocuments refuses a Legacy row once the flag is on", () => {
  it("pre-fix would attach a real document; the fix refuses", async () => {
    const submissionId = await mkLegacySubmission("UDD1");
    who.session = { user: { associateId: closerId, id: closerId } };
    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    const { uploadDocketDocuments } = (await import("@/app/portal/quotations/actions")) as {
      uploadDocketDocuments: (id: string, files: File[]) => Promise<{ ok: boolean; error?: string }>;
    };
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.pdf", { type: "application/pdf" });
    const r = await uploadDocketDocuments(submissionId, [file]);
    expect(r).toEqual({ ok: false, error: "legacyReadOnly" });
    expect(await prisma.submissionDocument.count({ where: { submissionId } })).toBe(0);
  });
});
