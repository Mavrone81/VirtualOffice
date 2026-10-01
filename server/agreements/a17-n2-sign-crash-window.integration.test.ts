// N2 (reviews/a17-flag-on-preconditions.md §2.4): signAshesAgreement's
// pdfKey/hash write, docket row and audit used to be three separate
// statements plus a best-effort logAudit — a crash between the PDF object
// write and the row update left the agreement Signed with NO PDF, in
// production, for every sale needing a Pet Ash agreement (Legacy or
// ClosedDeal), regardless of the flag. This is the closing-window test:
// force a REAL failure (a Postgres trigger refusing the audit_log insert,
// not a mock) after the PDF object is already written and inside the
// pdfKey/docket/audit transaction, and assert the agreement is never left
// Signed without a PDF. Real throwaway Postgres.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";

const TAG = "A17N2CRASH-";
let companyId = "", ashesProductId = "", closerId = "";
let submitSale: (input: unknown) => Promise<{ id?: string }>;
let signAshesAgreement: (submissionId: string, dataUrl: string) => Promise<{ ok: boolean; error?: string }>;

const FAKE_PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const FAKE_PNG_DATA_URL = `data:image/png;base64,${FAKE_PNG_BASE64}`;

beforeAll(async () => {
  process.env.A17_CLOSED_DEAL_FLOW = "true";
  vi.resetModules();
  ({ submitSale } = (await import("@/server/sales/actions")) as never);
  ({ signAshesAgreement } = (await import("./actions")) as never);
  await installAuditFault();

  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  ashesProductId = (await prisma.product.create({
    data: {
      productCode: TAG + "ASH", productName: "Columbarium Niche", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"), requiresAshesAgreement: true,
    },
    select: { id: true },
  })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterEach(async () => {
  who.session = null;
  await clearAuditFaults();
});

afterAll(async () => {
  delete process.env.A17_CLOSED_DEAL_FLOW;
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: closerId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  await prisma.submissionDocument.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.petsAshesAgreement.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.product.deleteMany({ where: { id: ashesProductId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await removeAuditFault();
});

async function newDraft(clientName: string) {
  who.session = { user: { associateId: closerId, id: closerId } };
  const r = await submitSale({
    salesDate: "2026-08-01", clientName, paymentPlan: "Full Payment",
    lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }],
  });
  return r.id!;
}

describe("signAshesAgreement — N2 crash window (pdfKey/docket/audit)", () => {
  it("a failure inside the pdfKey/docket/audit transaction — AFTER the PDF object is already written — never leaves the agreement Signed without a PDF", async () => {
    const subId = await newDraft("N2 Crash Client");
    const before = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { ashesAgreement: true } });
    const agreementId = before.ashesAgreement!.id;

    // The real crash point: the audit INSERT this transaction makes is
    // refused by a real Postgres trigger (not a mock), simulating a failure
    // that happens strictly AFTER renderAshesAgreementPdf + putObject have
    // already run (the PDF object genuinely exists in storage at this
    // point) and strictly INSIDE the pdfKey/docket/audit transaction.
    await failAuditsFor("ashes_agreement.signed");
    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await signAshesAgreement(subId, FAKE_PNG_DATA_URL);
    expect(r).toEqual({ ok: false, error: "auditUnavailable" });

    // The assertion that matters: never Signed without a PDF. Reverted all
    // the way to Draft (the same shape as the existing render-failure
    // revert), not left in some intermediate Signed-with-null-pdfKey state.
    const after = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(after.status).toBe("Draft");
    expect(after.signedAt).toBeNull();
    expect(after.applicantSignatureKey).toBeNull();
    expect(after.signedTerms).toBeNull();
    expect(after.agreementPdfKey).toBeNull();
    expect(after.signedPdfSha256).toBeNull();

    // No docket row and no audit row from this failed attempt — the
    // transaction rolling back must take the docket write with it, not
    // just the agreement row.
    expect(await prisma.submissionDocument.count({ where: { submissionId: subId, kind: "Signed" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: agreementId, action: "ashes_agreement.signed" } })).toBe(0);

    // Control: the revert leaves a cleanly re-signable row — a retry
    // (fault cleared) succeeds, and THAT attempt's docket + audit exist.
    await clearAuditFaults();
    const retry = await signAshesAgreement(subId, FAKE_PNG_DATA_URL);
    expect(retry).toEqual({ ok: true });
    const retried = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(retried.status).toBe("Signed");
    expect(retried.agreementPdfKey).not.toBeNull();
    expect(await prisma.submissionDocument.count({ where: { submissionId: subId, kind: "Signed" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: agreementId, action: "ashes_agreement.signed" } })).toBe(1);
  });
});
