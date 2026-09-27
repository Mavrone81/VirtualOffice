import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { productSalesByPeriod } from "./product-sales";

const TAG = "PRODSALES-";
const IN_PERIOD = new Date("2099-03-15");
const OUT_OF_PERIOD = new Date("2099-04-15"); // outside the queried window
const FROM = new Date("2099-03-01T00:00:00.000Z");
const TO = new Date("2099-04-01T00:00:00.000Z"); // exclusive, same convention as B-3's transaction-filters

let companyId = "";
let closerId = "";

async function mkBookedTransaction(code: string, salesDate: Date, lines: { productCode: string; productName: string; amount: string }[]) {
  const submission = await prisma.salesSubmission.create({
    data: {
      salesDate, clientName: TAG + code, saleAmount: "0", paymentPlan: "FullPayment" as never,
      closingAssociateId: closerId,
    },
    select: { id: true },
  });
  const transaction = await prisma.salesTransaction.create({
    data: {
      transactionCode: TAG + code, submissionId: submission.id, salesDate, clientName: TAG + code,
      saleAmount: "0", paymentPlan: "FullPayment" as never, closingAssociateId: closerId,
    },
    select: { id: true },
  });
  for (const l of lines) {
    await prisma.saleLineItem.create({
      data: {
        submissionId: submission.id, transactionId: transaction.id, companyId,
        productCode: l.productCode, productName: l.productName, commissionType: "Percentage" as never,
        lineSaleAmount: l.amount,
      },
    });
  }
  return { submissionId: submission.id, transactionId: transaction.id };
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } });
  companyId = company.id;
  const closer = await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  });
  closerId = closer.id;

  // Product A has a live Product row with its CURRENT name — the line items
  // below deliberately use STALE snapshot names, to prove grouping is by
  // productCode only and the display name comes from the Product table.
  // effectiveDate must be in the past relative to REAL wall-clock now (the
  // lookup uses today's actual date, not the 2099 fictional sale dates below).
  await prisma.product.create({
    data: {
      productCode: TAG + "A", productName: "Product A (current)", commissionType: "Percentage" as never,
      closingCommPct: "100", companyCutPct: "10", defaultCompanyId: companyId, effectiveDate: new Date("2020-01-01"),
    },
  });

  // Two booked transactions in period: two lines for Product A (sums to 3000, stale snapshot names)
  // + one for Product B (500, no Product row — exercises the fallback-to-snapshot-name path).
  await mkBookedTransaction("T1", IN_PERIOD, [{ productCode: TAG + "A", productName: "Product A (old name)", amount: "1000" }]);
  await mkBookedTransaction("T2", IN_PERIOD, [
    { productCode: TAG + "A", productName: "Product A (older name)", amount: "2000" },
    { productCode: TAG + "B", productName: "Product B (snapshot)", amount: "500" },
  ]);
  // A booked transaction OUTSIDE the queried period — must not be counted.
  await mkBookedTransaction("T3", OUT_OF_PERIOD, [{ productCode: TAG + "A", productName: "Product A (old name)", amount: "7777" }]);

  // An UNBOOKED submission (no transaction yet) — its line item must be excluded even though the date is in-period.
  const unbooked = await prisma.salesSubmission.create({
    data: { salesDate: IN_PERIOD, clientName: TAG + "unbooked", saleAmount: "0", paymentPlan: "FullPayment" as never, closingAssociateId: closerId },
    select: { id: true },
  });
  await prisma.saleLineItem.create({
    data: { submissionId: unbooked.id, transactionId: null, companyId, productCode: TAG + "A", productName: "Product A (old name)", commissionType: "Percentage" as never, lineSaleAmount: "9999" },
  });
});

afterAll(async () => {
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: { associateCode: { startsWith: TAG } } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: { associateCode: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

describe("productSalesByPeriod — B-6 product-sales chart aggregate (real DB)", () => {
  it("sums booked transactions' line items per product within the period, excludes unbooked lines and out-of-period rows", async () => {
    const rows = await productSalesByPeriod(FROM, TO);
    const a = rows.find((r) => r.productCode === TAG + "A")!;
    const b = rows.find((r) => r.productCode === TAG + "B")!;
    expect(a.total.toString()).toBe("3000"); // 1000 + 2000, NOT +9999 (unbooked) or +7777 (out of period)
    expect(b.total.toString()).toBe("500");
  });

  it("groups by productCode only: two line items with the same code and different snapshot names combine into one bar", async () => {
    const rows = await productSalesByPeriod(FROM, TO);
    const aRows = rows.filter((r) => r.productCode === TAG + "A");
    expect(aRows).toHaveLength(1); // not split by the two different stale snapshot names
    expect(aRows[0].total.toString()).toBe("3000");
  });

  it("uses the Product table's current name, not either stale line-item snapshot", async () => {
    const rows = await productSalesByPeriod(FROM, TO);
    const a = rows.find((r) => r.productCode === TAG + "A")!;
    expect(a.productName).toBe("Product A (current)");
  });

  it("falls back to the latest line item's snapshot name when there's no Product row for that code", async () => {
    const rows = await productSalesByPeriod(FROM, TO);
    const b = rows.find((r) => r.productCode === TAG + "B")!;
    expect(b.productName).toBe("Product B (snapshot)");
  });

  it("sorts descending by total", async () => {
    const rows = await productSalesByPeriod(FROM, TO);
    const idxA = rows.findIndex((r) => r.productCode === TAG + "A");
    const idxB = rows.findIndex((r) => r.productCode === TAG + "B");
    expect(idxA).toBeLessThan(idxB);
  });

  it("an empty period returns nothing", async () => {
    const rows = await productSalesByPeriod(new Date("2010-01-01"), new Date("2010-02-01"));
    expect(rows.find((r) => r.productCode === TAG + "A")).toBeUndefined();
  });
});
