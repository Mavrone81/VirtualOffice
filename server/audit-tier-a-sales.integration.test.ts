// Audit reliability (reviews/audit-reliability.md) — Tier A sales actions: a
// failed audit rolls the approval/decision back ("auditUnavailable", no stamp).
// Real Postgres + real auditTx; audit failures injected with the local-only
// trigger (lib/test-audit-fault.ts). Only the split-bound CALCULATION is stubbed
// (which lines go negative), so the exception approval runs for real without a
// product/rate fixture. Fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const NEG = [{ productCode: "FAKE", lineType: "Personal", associateId: null, amount: "-10.00" }];
vi.mock("@/server/commission/split-bounds", async (orig) => ({
  ...(await orig<typeof import("@/server/commission/split-bounds")>()),
  splitBoundViolations: vi.fn(async () => NEG),
}));

import { prisma } from "@/lib/db";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";
import { approveSplitException, adminApproveSplit, approveQuotation, rejectSubmission } from "./sales/actions";

const TAG = "AUDTS-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let closerId = "";

const mkSubmission = (code: string) => prisma.salesSubmission.create({
  data: { salesDate: new Date("2196-05-01"), clientName: TAG + code, saleAmount: 1000, paymentPlan: "FullPayment", closingAssociateId: closerId, amountCollected: 0, status: "Submitted" },
  select: { id: true, splitEditedAt: true },
});

beforeAll(async () => {
  await installAuditFault();
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "C1", fullName: TAG + "Closer", designation: "SalesAssociate", approvalStatus: "Approved", associateStatus: "Active" },
    select: { id: true },
  })).id;
  who.session = ADMIN;
});
afterEach(clearAuditFaults);
afterAll(async () => {
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await removeAuditFault();
});

describe("Tier A sales actions roll back when their audit can't be written", () => {
  it("split exception approve: no approval stamp", async () => {
    const s = await mkSubmission("EX");
    await failAuditsFor("split.exception_approved");
    const r = await approveSplitException(s.id, "approved by the project owner (fake)", s.splitEditedAt?.toISOString() ?? null, NEG);
    expect(r).toEqual({ ok: false, error: "auditUnavailable" });
    const row = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.splitExceptionApprovedAt).toBeNull();

    await clearAuditFaults();
    expect(await approveSplitException(s.id, "approved by the project owner (fake)", s.splitEditedAt?.toISOString() ?? null, NEG)).toEqual({ ok: true });
    expect(await prisma.auditLog.count({ where: { action: "split.exception_approved", entityId: s.id } })).toBe(1);
  });

  it("admin split sign-off: no stamp (incl. the system SD auto-approval audit)", async () => {
    const s = await mkSubmission("AS");
    await failAuditsFor("submission.split_admin_approved");
    expect(await adminApproveSplit(s.id, s.splitEditedAt?.toISOString() ?? null)).toEqual({ ok: false, error: "auditUnavailable" });
    const row = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.splitAdminApprovedAt).toBeNull();
    expect(row.sdApprovedAt).toBeNull(); // the auto SD stamp rolled back with it
  });

  it("quotation approval: stays Submitted", async () => {
    const s = await mkSubmission("QA");
    await failAuditsFor("submission.quotation_approved");
    expect(await approveQuotation(s.id)).toEqual({ ok: false, error: "auditUnavailable" });
    expect((await prisma.salesSubmission.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("Submitted");
  });

  it("reject: stays Submitted", async () => {
    const s = await mkSubmission("RJ");
    await failAuditsFor("submission.rejected");
    expect(await rejectSubmission(s.id, "fake reason")).toEqual({ ok: false, error: "auditUnavailable" });
    expect((await prisma.salesSubmission.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("Submitted");
  });
});
