// A-17 §3: rejectSubmission (Admin/Accounts, reason, Submitted-only, CAS).
// Flag on: refuses Legacy, requires a reason, stamps rejectedAt (drives §4a).
// Flag off: byte-for-byte the pre-A-17 legacy behaviour (reason optional).
// Real throwaway Postgres.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";

const TAG = "A17REJECT-";
let companyId = "", productId = "", closerId = "", adminId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Grave Plot", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"),
    },
    select: { id: true },
  })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  adminId = "55555555-5555-5555-5555-555555555555";
});

afterAll(async () => {
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: closerId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

afterEach(() => {
  who.session = null;
});

async function makeSubmission(submit: (input: unknown) => Promise<{ id?: string }>) {
  who.session = { user: { associateId: closerId, id: closerId } };
  const r = await submit({
    salesDate: "2026-08-01", clientName: "Reject Me", paymentPlan: "Full Payment",
    lines: [{ productId, lineSaleAmount: 1000, comCodeIds: [] }],
  });
  return r.id!;
}

describe("rejectSubmission — flag OFF (default): unchanged legacy behaviour", () => {
  // Forced explicitly rather than relying on ambient process env being unset
  // — a static top-level import here would silently mis-test under A-17's
  // own shipping configuration (A17_CLOSED_DEAL_FLOW=true ambient).
  let rejectFlagOff: (id: string, reason?: string) => Promise<{ ok: boolean; error?: string }>;
  let submitFlagOff: (input: unknown) => Promise<{ ok: boolean; id?: string }>;

  beforeAll(async () => {
    delete process.env.A17_CLOSED_DEAL_FLOW;
    vi.resetModules();
    ({ rejectSubmission: rejectFlagOff, submitSale: submitFlagOff } = (await import("./actions")) as never);
  });

  it("rejects with no reason at all, exactly as before A-17", async () => {
    const subId = await makeSubmission(submitFlagOff as never);
    who.session = { user: { id: "66666666-6666-6666-6666-666666666666", associateId: null, role: "Admin" } };
    const r = await rejectFlagOff(subId);
    expect(r.ok).toBe(true);
    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { status: true, flow: true } });
    expect(sub.status).toBe("Rejected");
    expect(sub.flow).toBe("Legacy"); // never touched by the flag-off path
  });
});

describe("rejectSubmission — flag ON", () => {
  let submitSale: (input: unknown) => Promise<{ id?: string }>;
  let rejectSubmission: (id: string, reason?: string) => Promise<{ ok: boolean; error?: string }>;

  beforeAll(async () => {
    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    ({ submitSale, rejectSubmission } = (await import("./actions")) as never);
  });
  afterAll(() => {
    delete process.env.A17_CLOSED_DEAL_FLOW;
  });

  it("rejects a non-admin", async () => {
    const subId = await makeSubmission(submitSale);
    who.session = { user: { associateId: closerId, id: closerId, role: "SalesAssociate" } };
    const r = await rejectSubmission(subId, "not good enough");
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("requires a reason", async () => {
    const subId = await makeSubmission(submitSale);
    who.session = { user: { id: adminId, associateId: null, role: "Admin" } };
    const r = await rejectSubmission(subId, "");
    expect(r).toEqual({ ok: false, error: "reasonRequired" });
  });

  it("rejects a Submitted sale, stamping rejectedAt and auditing the reason", async () => {
    const subId = await makeSubmission(submitSale);
    who.session = { user: { id: adminId, associateId: null, role: "Accounts" } };
    const r = await rejectSubmission(subId, "missing signed contract");
    expect(r.ok).toBe(true);

    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: subId }, select: { status: true, rejectedAt: true } });
    expect(sub.status).toBe("Rejected");
    expect(sub.rejectedAt).not.toBeNull();

    const audits = await prisma.auditLog.findMany({ where: { entityId: subId, action: "submission.rejected" } });
    expect(audits).toHaveLength(1);
    expect((audits[0].afterJson as { reason: string }).reason).toBe("missing signed contract");
  });

  it("is a CAS — rejecting twice refuses the second with alreadyProcessed", async () => {
    const subId = await makeSubmission(submitSale);
    who.session = { user: { id: adminId, associateId: null, role: "Admin" } };
    expect((await rejectSubmission(subId, "first reason")).ok).toBe(true);
    expect(await rejectSubmission(subId, "second reason")).toEqual({ ok: false, error: "alreadyProcessed" });
  });

  it("refuses a Legacy row", async () => {
    const subId = await makeSubmission(submitSale);
    await prisma.salesSubmission.update({ where: { id: subId }, data: { flow: "Legacy" as never } });
    who.session = { user: { id: adminId, associateId: null, role: "Admin" } };
    const r = await rejectSubmission(subId, "some reason");
    expect(r).toEqual({ ok: false, error: "legacyReadOnly" });
  });
});
