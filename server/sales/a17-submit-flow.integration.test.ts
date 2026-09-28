// A-17 §3/§4: submitSale, behind env.A17_CLOSED_DEAL_FLOW, sets
// flow=ClosedDeal + assigns the TXN code immediately, and auto-generates a
// Pet Ash draft when a line's product requires it — all in one DB
// transaction. Flag off must be byte-for-byte the pre-A-17 behaviour.
// Real throwaway Postgres; fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";

const TAG = "A17SUBMIT-";
let companyId = "", ashesProductId = "", plainProductId = "", closerId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  ashesProductId = (await prisma.product.create({
    data: {
      productCode: TAG + "ASH", productName: "Columbarium Niche", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"), requiresAshesAgreement: true,
    },
    select: { id: true },
  })).id;
  plainProductId = (await prisma.product.create({
    data: {
      productCode: TAG + "PLN", productName: "Grave Plot", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"), requiresAshesAgreement: false,
    },
    select: { id: true },
  })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: closerId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  await prisma.petsAshesAgreement.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.product.deleteMany({ where: { id: { in: [ashesProductId, plainProductId] } } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

afterEach(() => {
  who.session = null;
});

describe("submitSale — flag OFF (default): unchanged legacy behaviour", () => {
  // Forced explicitly, not left to whatever the ambient process env happens to
  // be — the earlier static top-level import assumed "the process default is
  // off", which breaks the moment the whole suite is run in A-17's own
  // shipping configuration (A17_CLOSED_DEAL_FLOW=true ambient): every other
  // "flag OFF" claim in this codebase is asserted the same explicit way (see
  // the "flag ON" describe below, and every a17-*.integration.test.ts file
  // that forces true), this just forces false instead of relying on absence.
  let submitSaleFlagOff: (input: unknown) => Promise<{ ok: boolean; id?: string; transactionCode?: string; quotationConverted?: boolean }>;

  beforeAll(async () => {
    delete process.env.A17_CLOSED_DEAL_FLOW;
    vi.resetModules();
    ({ submitSale: submitSaleFlagOff } = (await import("./actions")) as never);
  });

  it("stays flow=Legacy with no transaction code, even for a Pet Ash product", async () => {
    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await submitSaleFlagOff({
      salesDate: "2026-08-01", clientName: "Legacy Client", paymentPlan: "Full Payment",
      lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }],
    });
    expect(r.ok).toBe(true);
    expect(r.transactionCode).toBeUndefined();

    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: r.id }, select: { flow: true, transactionCode: true, ashesAgreement: true } });
    expect(sub.flow).toBe("Legacy");
    expect(sub.transactionCode).toBeNull();
    expect(sub.ashesAgreement).toBeNull(); // no auto-draft while the flag is off
  });

  // L1 (DevLead review): quotation conversion is A-17 only — flag off ignores
  // quotationId entirely, no CAS, nothing stored.
  it("ignores a passed quotationId entirely — no CAS, nothing stored", async () => {
    const quotationId = (await prisma.quotation.create({
      data: { quotationCode: `${TAG}QUO-OFF`, associateId: closerId, clientName: "Quote Client", quoteDate: new Date("2026-08-01"), lines: [], total: "1000.00", status: "Issued" as never },
      select: { id: true },
    })).id;
    try {
      who.session = { user: { associateId: closerId, id: closerId } };
      const r = await submitSaleFlagOff({
        salesDate: "2026-08-01", clientName: "Flag Off Quote Client", paymentPlan: "Full Payment",
        lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }], quotationId,
      });
      expect(r.ok).toBe(true);

      const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: r.id }, select: { quotationId: true } });
      expect(sub.quotationId).toBeNull();
      const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, select: { status: true } });
      expect(quotation.status).toBe("Issued"); // untouched
      expect(await prisma.auditLog.count({ where: { entityId: quotationId, action: "quotation.converted" } })).toBe(0);
    } finally {
      await prisma.quotation.deleteMany({ where: { id: quotationId } });
    }
  });
});

describe("submitSale — flag ON: ClosedDeal flow", () => {
  let submitSale: (input: unknown) => Promise<{ ok: boolean; error?: string; id?: string; transactionCode?: string; quotationConverted?: boolean }>;

  beforeAll(async () => {
    process.env.A17_CLOSED_DEAL_FLOW = "true";
    vi.resetModules();
    ({ submitSale } = (await import("./actions")) as never);
  });
  afterAll(() => {
    delete process.env.A17_CLOSED_DEAL_FLOW;
  });

  it("assigns flow=ClosedDeal + a TXN code immediately, and audits sale.submitted", async () => {
    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await submitSale({
      salesDate: "2026-08-01", clientName: "New Flow Client", paymentPlan: "Full Payment",
      lines: [{ productId: plainProductId, lineSaleAmount: 2000, comCodeIds: [] }],
    });
    expect(r.ok).toBe(true);
    expect(r.transactionCode).toMatch(/^TXN-\d{4,}$/);

    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: r.id }, select: { flow: true, transactionCode: true, ashesAgreement: true } });
    expect(sub.flow).toBe("ClosedDeal");
    expect(sub.transactionCode).toBe(r.transactionCode);
    expect(sub.ashesAgreement).toBeNull(); // this product doesn't need one

    const audits = await prisma.auditLog.findMany({ where: { entityId: r.id, action: "sale.submitted" } });
    expect(audits).toHaveLength(1);
    expect((audits[0].afterJson as { transactionCode: string }).transactionCode).toBe(r.transactionCode);
  });

  it("auto-generates a Pet Ash draft, prefilled from the sale, when a line's product requires it", async () => {
    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await submitSale({
      salesDate: "2026-08-01", clientName: "Ashes Client", paymentPlan: "Full Payment",
      lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }],
    });
    expect(r.ok).toBe(true);

    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: r.id }, select: { ashesAgreement: true } });
    expect(sub.ashesAgreement).not.toBeNull();
    expect(sub.ashesAgreement!.status).toBe("Draft");
    expect(sub.ashesAgreement!.applicant1Name).toBe("Ashes Client");
    expect(sub.ashesAgreement!.amountNumeric.toFixed(2)).toBe("1000.00");
    expect(sub.ashesAgreement!.amountWords).toMatch(/One Thousand/);
    expect(sub.ashesAgreement!.paymentPlan).toBe("FullPayment");
    expect(sub.ashesAgreement!.bookingFee).toBeNull();
    expect(sub.ashesAgreement!.monthlyInstalment).toBeNull();

    const generated = await prisma.auditLog.findMany({ where: { entityId: r.id, action: "ashes.generated" } });
    expect(generated).toHaveLength(1);
  });

  it("prefills bookingFee/monthlyInstalment from the deposit + installment count", async () => {
    who.session = { user: { associateId: closerId, id: closerId } };
    const r = await submitSale({
      salesDate: "2026-08-01", clientName: "Instalment Ashes Client", paymentPlan: "Installment",
      deposit: 100, installmentCount: 3,
      lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }],
    });
    expect(r.ok).toBe(true);

    const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: r.id }, select: { ashesAgreement: true } });
    expect(sub.ashesAgreement!.paymentPlan).toBe("Installment");
    expect(sub.ashesAgreement!.bookingFee!.toFixed(2)).toBe("100.00");
    expect(sub.ashesAgreement!.monthlyInstalment!.toFixed(2)).toBe("300.00"); // (1000-100)/3
  });

  it("never creates a submission without its TXN code, or vice versa — the create and the draft are one transaction", async () => {
    // Two submits from the same closer must never collide on TXN code.
    who.session = { user: { associateId: closerId, id: closerId } };
    const [a, b] = await Promise.all([
      submitSale({ salesDate: "2026-08-01", clientName: "A", paymentPlan: "Full Payment", lines: [{ productId: plainProductId, lineSaleAmount: 500, comCodeIds: [] }] }),
      submitSale({ salesDate: "2026-08-01", clientName: "B", paymentPlan: "Full Payment", lines: [{ productId: plainProductId, lineSaleAmount: 500, comCodeIds: [] }] }),
    ]);
    expect(a.transactionCode).not.toBe(b.transactionCode);
  });

  describe("quotationId: converting a quotation into this sale", () => {
    let quoteN = 0;
    async function mkQuotation(status: "Issued" | "Converted" | "Void" = "Issued", associateId = closerId) {
      return (await prisma.quotation.create({
        data: {
          quotationCode: `${TAG}QUO-${++quoteN}`, associateId, clientName: "Quote Client",
          quoteDate: new Date("2026-08-01"), lines: [], total: "1000.00",
          status: status as never,
        },
        select: { id: true },
      })).id;
    }

    afterEach(async () => {
      await prisma.quotation.deleteMany({ where: { quotationCode: { startsWith: `${TAG}QUO-` } } });
    });

    it("happy path: CASes the quotation Issued -> Converted and audits quotation.converted with the submission id", async () => {
      const quotationId = await mkQuotation();
      who.session = { user: { associateId: closerId, id: closerId } };
      const r = await submitSale({
        salesDate: "2026-08-01", clientName: "Converted Client", paymentPlan: "Full Payment",
        lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }], quotationId,
      });
      expect(r.ok).toBe(true);

      const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: r.id }, select: { quotationId: true } });
      expect(sub.quotationId).toBe(quotationId);
      const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, select: { status: true } });
      expect(quotation.status).toBe("Converted");

      const audits = await prisma.auditLog.findMany({ where: { entityId: quotationId, action: "quotation.converted" } });
      expect(audits).toHaveLength(1);
      expect((audits[0].afterJson as { submissionId: string }).submissionId).toBe(r.id);
    });

    it("already-converted: refuses and creates no submission, leaving the quotation untouched", async () => {
      const quotationId = await mkQuotation("Converted");
      who.session = { user: { associateId: closerId, id: closerId } };
      // L2 (DevLead review): scope to this closer, not a global count — other
      // test files share this DB and may be creating submissions in parallel.
      const before = await prisma.salesSubmission.count({ where: { closingAssociateId: closerId } });
      const r = await submitSale({
        salesDate: "2026-08-01", clientName: "Rejected Client", paymentPlan: "Full Payment",
        lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }], quotationId,
      });
      expect(r).toEqual({ ok: false, error: "quotationNotConvertible" });
      expect(await prisma.salesSubmission.count({ where: { closingAssociateId: closerId } })).toBe(before); // rolled back, not just refused

      const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, select: { status: true } });
      expect(quotation.status).toBe("Converted"); // untouched, not double-audited
      expect(await prisma.auditLog.count({ where: { entityId: quotationId, action: "quotation.converted" } })).toBe(0);
    });

    it("a voided quotation, or one owned by someone else, is refused the same way", async () => {
      who.session = { user: { associateId: closerId, id: closerId } };
      const voidedId = await mkQuotation("Void");
      const r1 = await submitSale({
        salesDate: "2026-08-01", clientName: "Void Client", paymentPlan: "Full Payment",
        lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }], quotationId: voidedId,
      });
      expect(r1).toEqual({ ok: false, error: "quotationNotConvertible" });

      const otherAssociateId = (await prisma.associate.create({
        data: { associateCode: TAG + "OTH", fullName: "Other", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
        select: { id: true },
      })).id;
      const notMineId = await mkQuotation("Issued", otherAssociateId);
      try {
        const r2 = await submitSale({
          salesDate: "2026-08-01", clientName: "Not Mine Client", paymentPlan: "Full Payment",
          lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }], quotationId: notMineId,
        });
        expect(r2).toEqual({ ok: false, error: "quotationNotConvertible" });
      } finally {
        await prisma.quotation.deleteMany({ where: { id: notMineId } });
        await prisma.associate.deleteMany({ where: { id: otherAssociateId } });
      }
    });

    it("N6: an EXPIRED quotation (validUntil in the past) is refused the same way, not silently converted", async () => {
      who.session = { user: { associateId: closerId, id: closerId } };
      const expiredId = (await prisma.quotation.create({
        data: {
          quotationCode: `${TAG}QUO-${++quoteN}`, associateId: closerId, clientName: "Quote Client",
          quoteDate: new Date("2026-01-01"), validUntil: new Date("2026-01-15"), lines: [], total: "1000.00",
          status: "Issued" as never,
        },
        select: { id: true },
      })).id;
      try {
        const r = await submitSale({
          salesDate: "2026-08-01", clientName: "Expired Client", paymentPlan: "Full Payment",
          lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }], quotationId: expiredId,
        });
        expect(r).toEqual({ ok: false, error: "quotationNotConvertible" });
        const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: expiredId }, select: { status: true } });
        expect(quotation.status).toBe("Issued"); // untouched — never converted
        expect(await prisma.auditLog.count({ where: { entityId: expiredId, action: "quotation.converted" } })).toBe(0);
      } finally {
        await prisma.quotation.deleteMany({ where: { id: expiredId } });
      }
    });

    it("concurrent double-submit of the same quotation: exactly one converts it", async () => {
      const quotationId = await mkQuotation();
      who.session = { user: { associateId: closerId, id: closerId } };
      const [a, b] = await Promise.all([
        submitSale({ salesDate: "2026-08-01", clientName: "Race A", paymentPlan: "Full Payment", lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }], quotationId }),
        submitSale({ salesDate: "2026-08-01", clientName: "Race B", paymentPlan: "Full Payment", lines: [{ productId: plainProductId, lineSaleAmount: 1000, comCodeIds: [] }], quotationId }),
      ]);
      const results = [a, b];
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.error === "quotationNotConvertible")).toHaveLength(1);

      const winner = results.find((r) => r.ok)!;
      const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, select: { status: true } });
      expect(quotation.status).toBe("Converted");
      expect(await prisma.salesSubmission.count({ where: { quotationId } })).toBe(1);
      const sub = await prisma.salesSubmission.findFirstOrThrow({ where: { quotationId }, select: { id: true } });
      expect(sub.id).toBe(winner.id);
    });
  });
});
