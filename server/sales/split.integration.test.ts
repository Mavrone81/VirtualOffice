import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitSale, verifySubmission } from "./actions";

const TAG = "SPLIT4-";
const SALE_DATE = "2099-02-10";
let companyId = "", productId = "", sdId = "", smId = "", closerId = "", a2Id = "";

async function mkAssoc(code: string, designation: string, direct: string | null, second: string | null) {
  const a = await prisma.associate.create({
    data: {
      associateCode: TAG + code, fullName: code, designation: designation as never,
      directUplineId: direct, secondUplineId: second,
      approvalStatus: "Approved" as never, associateStatus: "Active" as never,
    },
    select: { id: true },
  });
  return a.id;
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true },
  });
  companyId = company.id;
  const product = await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Split Test", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date(SALE_DATE),
    },
    select: { id: true },
  });
  productId = product.id;
  await prisma.commissionStructureVersion.create({
    data: {
      productCode: TAG + "P1", productId, effectiveDate: new Date("2099-01-01"),
      rateSnapshot: {
        commissionType: "Percentage", closingCommPct: "10", closingCommFixed: null,
        companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
        isExternal: false, externalCompanyRetainedPct: null,
      } as never,
    },
  });
  sdId = await mkAssoc("SD", "SalesDirector", null, null);
  smId = await mkAssoc("SM", "SalesManager", sdId, null);
  closerId = await mkAssoc("CL", "SalesAssociate", smId, sdId);
  a2Id = await mkAssoc("A2", "SalesAssociate", smId, sdId);
});

afterAll(async () => {
  // FK order: ledger + invoices reference the transaction, line items reference
  // the transaction + submission, so delete children before parents.
  // Ledger via the transaction relation so null-associate CompanyRetained rows are caught too.
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: { associateCode: { startsWith: TAG } } } } });
  await prisma.invoice.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: { associateCode: { startsWith: TAG } } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: { associateCode: { startsWith: TAG } } } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

const num = (d: unknown) => Number(d as number);

describe("Associate 2/3 split flows submit → verify → ledger", () => {
  it("a 25% Associate 2 split gives closer 600 / A2 200 (of net 800); overrides unchanged", async () => {
    who.session = { user: { associateId: closerId, id: "sess-closer" } };
    const submit = await submitSale({
      salesDate: SALE_DATE, clientName: TAG + "Client", paymentPlan: "Full Payment",
      lines: [{ productId, lineSaleAmount: 10000, comCodeIds: [] }],
      associate2: { associateId: a2Id, valueType: "Percentage", value: 25 },
    } as never);
    expect(submit.ok).toBe(true);

    const sub = await prisma.salesSubmission.findFirstOrThrow({
      where: { closingAssociateId: closerId }, orderBy: { createdAt: "desc" }, select: { id: true },
    });

    who.session = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
    const verified = await verifySubmission(sub.id);
    expect(verified.ok).toBe(true);

    const ledger = await prisma.commissionLedger.findMany({
      where: { associate: { associateCode: { startsWith: TAG } } },
      select: { associateId: true, amount: true },
    });
    const sumFor = (id: string) => ledger.filter((l) => l.associateId === id).reduce((s, l) => s + num(l.amount), 0);
    expect(sumFor(closerId)).toBeCloseTo(600, 2); // 800 net − 200
    expect(sumFor(a2Id)).toBeCloseTo(200, 2); // 25% of 800
    expect(sumFor(smId)).toBeCloseTo(500, 2); // SM overriding on sale (unchanged by split)
    expect(sumFor(sdId)).toBeCloseTo(300, 2); // SD overriding on sale
  });
});
