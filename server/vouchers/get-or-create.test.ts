// A-7 — one voucher per SETTLING payout, frozen at issue: the first
// getOrCreateVoucher call for a (transaction, associate, payout) triple
// snapshots exactly that payout's settled lines; every later call for the
// SAME payout returns that exact row, even after more gets paid by OTHER
// payouts. No voucher (null) when this payout isn't Paid, or settled
// nothing on this transaction for this associate. Real throwaway Postgres
// (needs DATABASE_URL); fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getOrCreateVoucher, listVouchersForTransaction, listVouchersForTransactions, VoucherAccessDenied } from "./get-or-create";
import { formatVoucherReference } from "@/lib/pdf/voucher-reference";

const TAG = "A7VOUCHER-";
let companyId = "", closerId = "", otherId = "";
const PRINCIPAL = () => ({ associateId: closerId, role: "SalesAssociate" as never });

async function mkTransaction(code: string, clientName: string) {
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2099-06-01"), clientName, saleAmount: 1000, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0 },
    select: { id: true },
  });
  return prisma.salesTransaction.create({
    data: { transactionCode: TAG + code, submissionId: sub.id, salesDate: new Date("2099-06-01"), clientName, saleAmount: 1000, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0 },
  });
}

async function mkPayout(payoutMonth: string, paidDate: Date, status: "Paid" | "Pending" = "Paid") {
  return prisma.monthlyPayout.create({
    data: { payoutMonth, associateId: closerId, seq: 0, kind: "Regular" as never, associateName: "Closer", designation: "SalesAssociate" as never, payoutStatus: status as never, totalPayable: 0, paidDate: status === "Paid" ? paidDate : null },
  });
}

async function settleLine(transactionId: string, payoutId: string, payoutMonth: string, amount: number, status: "Eligible" | "Cancelled" = "Eligible") {
  await prisma.commissionLedger.create({
    data: { transactionId, payoutMonth, associateId: closerId, associateName: "Closer", lineType: "Personal" as never, basisAmount: amount, amount, eligibility: "Eligible" as never, status: status as never, payoutId },
  });
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  otherId = (await prisma.associate.create({
    data: { associateCode: TAG + "OTH", fullName: "Other", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.paymentVoucher.deleteMany({ where: { associateId: closerId } });
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.monthlyPayout.deleteMany({ where: { associateId: closerId } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: { in: [closerId, otherId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("getOrCreateVoucher", () => {
  it("returns null for an unknown payout id", async () => {
    const tx = await mkTransaction("NONE1", "Jane Tan");
    expect(await getOrCreateVoucher(tx.id, closerId, "00000000-0000-4000-8000-000000000000", PRINCIPAL())).toBeNull();
  });

  it("returns null while the payout isn't Paid yet", async () => {
    const tx = await mkTransaction("NONE2", "Jane Tan");
    const payout = await mkPayout("2091-01", new Date(), "Pending");
    await settleLine(tx.id, payout.id, "2091-01", 400);
    expect(await getOrCreateVoucher(tx.id, closerId, payout.id, PRINCIPAL())).toBeNull();
  });

  it("returns null when the (Paid) payout settled nothing on this transaction for this associate", async () => {
    const tx = await mkTransaction("NONE3", "Jane Tan");
    const payout = await mkPayout("2092-01", new Date("2092-01-15"));
    expect(await getOrCreateVoucher(tx.id, closerId, payout.id, PRINCIPAL())).toBeNull();
  });

  it("issues one voucher per settling payout, each with only that payout's own lines, seq 1 then 2 — and totals equal the settled lines", async () => {
    const tx = await mkTransaction("ISSUE", "Jane Tan");
    const payout1 = await mkPayout("2093-01", new Date("2098-01-15"));
    await settleLine(tx.id, payout1.id, "2093-01", 400);

    const v1 = await getOrCreateVoucher(tx.id, closerId, payout1.id, PRINCIPAL());
    expect(v1).not.toBeNull();
    expect(v1!.seq).toBe(1);
    expect(v1!.reference).toBe(formatVoucherReference(TAG + "ISSUE", TAG + "CL", 1));
    expect(v1!.clientInitials).toBe("JT");
    expect(v1!.totalPaid.toFixed(2)).toBe("400.00");
    expect(v1!.payoutMonths).toEqual(["2093-01"]);
    expect(new Date(v1!.paidDate).toISOString()).toBe(new Date("2098-01-15").toISOString());
    expect(v1!.lines as unknown as unknown[]).toHaveLength(1);

    // A second payout settles the rest — a SECOND, distinct voucher, not a rewrite of the first.
    const payout2 = await mkPayout("2093-02", new Date("2098-02-10"));
    await settleLine(tx.id, payout2.id, "2093-02", 100);

    const v2 = await getOrCreateVoucher(tx.id, closerId, payout2.id, PRINCIPAL());
    expect(v2!.id).not.toBe(v1!.id);
    expect(v2!.seq).toBe(2);
    expect(v2!.reference).toBe(formatVoucherReference(TAG + "ISSUE", TAG + "CL", 2));
    expect(v2!.totalPaid.toFixed(2)).toBe("100.00");
    expect(v2!.payoutMonths).toEqual(["2093-02"]);

    // The first voucher is untouched by the second payout.
    const v1Again = await getOrCreateVoucher(tx.id, closerId, payout1.id, PRINCIPAL());
    expect(v1Again!.id).toBe(v1!.id);
    expect(v1Again!.totalPaid.toFixed(2)).toBe("400.00");
  });

  it("a sale paid in one go gets exactly one voucher, numbered 1", async () => {
    const tx = await mkTransaction("ONESHOT", "Ah Beng");
    const payout = await mkPayout("2094-01", new Date("2098-03-01"));
    await settleLine(tx.id, payout.id, "2094-01", 1000);
    const v = await getOrCreateVoucher(tx.id, closerId, payout.id, PRINCIPAL());
    expect(v!.seq).toBe(1);
    expect(v!.reference).toBe(formatVoucherReference(TAG + "ONESHOT", TAG + "CL", 1));
  });

  it("two concurrent first requests for the SAME payout race the unique constraint but both see the same frozen voucher", async () => {
    const tx = await mkTransaction("RACE", "Ah Beng");
    const payout = await mkPayout("2095-01", new Date("2098-04-05"));
    await settleLine(tx.id, payout.id, "2095-01", 200);

    const [a, b] = await Promise.all([getOrCreateVoucher(tx.id, closerId, payout.id, PRINCIPAL()), getOrCreateVoucher(tx.id, closerId, payout.id, PRINCIPAL())]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).toBe(b!.id);
    expect(a!.totalPaid.toFixed(2)).toBe(b!.totalPaid.toFixed(2));

    const count = await prisma.paymentVoucher.count({ where: { transactionId: tx.id, associateId: closerId, payoutId: payout.id } });
    expect(count).toBe(1); // exactly one row, not two
  });

  it("Cancelled ledger lines are excluded from the total", async () => {
    const tx = await mkTransaction("CANCEL", "Mary Lim");
    const payout = await mkPayout("2096-01", new Date("2098-05-01"));
    await settleLine(tx.id, payout.id, "2096-01", 300);
    await settleLine(tx.id, payout.id, "2096-01", 50, "Cancelled");

    const v = await getOrCreateVoucher(tx.id, closerId, payout.id, PRINCIPAL());
    expect(v!.totalPaid.toFixed(2)).toBe("300.00"); // the Cancelled 50 is excluded
  });

  // seq is the payout's position among settling payouts ordered by
  // (paidDate, payoutMonth, payoutId), never a count of already-issued
  // vouchers — a count races two DIFFERENT payouts onto the same
  // seq/reference, and numbers by download order instead of settlement order.
  it("two DIFFERENT payouts issued concurrently for the first time get two distinct references, both issued", async () => {
    const tx = await mkTransaction("RACE2", "Concurrent Client");
    const payoutA = await mkPayout("2099-01", new Date("2099-01-15"));
    await settleLine(tx.id, payoutA.id, "2099-01", 400);
    const payoutB = await mkPayout("2099-02", new Date("2099-02-15"));
    await settleLine(tx.id, payoutB.id, "2099-02", 100);

    const [va, vb] = await Promise.all([
      getOrCreateVoucher(tx.id, closerId, payoutA.id, PRINCIPAL()),
      getOrCreateVoucher(tx.id, closerId, payoutB.id, PRINCIPAL()),
    ]);
    expect(va).not.toBeNull();
    expect(vb).not.toBeNull();
    expect(va!.reference).not.toBe(vb!.reference);
    expect(new Set([va!.seq, vb!.seq])).toEqual(new Set([1, 2]));
    expect(await prisma.paymentVoucher.count({ where: { transactionId: tx.id, associateId: closerId } })).toBe(2);
  });

  it("issuing the LATER-settled payout first still numbers it 2 — seq follows settlement order, not download order", async () => {
    const tx = await mkTransaction("ORDER", "Download Order Client");
    const payout1 = await mkPayout("2099-03", new Date("2099-03-15")); // settles first
    await settleLine(tx.id, payout1.id, "2099-03", 400);
    const payout2 = await mkPayout("2099-04", new Date("2099-04-15")); // settles second
    await settleLine(tx.id, payout2.id, "2099-04", 100);

    // Downloaded out of order: the later-settled payout first.
    const v2 = await getOrCreateVoucher(tx.id, closerId, payout2.id, PRINCIPAL());
    expect(v2!.seq).toBe(2);
    expect(v2!.reference).toBe(formatVoucherReference(TAG + "ORDER", TAG + "CL", 2));

    const v1 = await getOrCreateVoucher(tx.id, closerId, payout1.id, PRINCIPAL());
    expect(v1!.seq).toBe(1);
    expect(v1!.reference).toBe(formatVoucherReference(TAG + "ORDER", TAG + "CL", 1));
  });
});

describe("listVouchersForTransaction", () => {
  it("lists one row per settling payout, oldest first, marking which are already issued, totals equal the settled lines", async () => {
    const tx = await mkTransaction("LIST", "List Client");
    const payout1 = await mkPayout("2097-01", new Date("2098-06-01"));
    await settleLine(tx.id, payout1.id, "2097-01", 400);
    const payout2 = await mkPayout("2097-02", new Date("2098-07-01"));
    await settleLine(tx.id, payout2.id, "2097-02", 100);

    const beforeIssue = await listVouchersForTransaction(tx.id, closerId, PRINCIPAL());
    expect(beforeIssue).toHaveLength(2);
    expect(beforeIssue.every((v) => v.issued === false)).toBe(true);
    expect(beforeIssue[0].payoutId).toBe(payout1.id); // oldest first
    expect(beforeIssue[0].totalPaid).toBe("400.00");
    expect(beforeIssue[1].payoutId).toBe(payout2.id);

    await getOrCreateVoucher(tx.id, closerId, payout1.id, PRINCIPAL());
    const afterIssue = await listVouchersForTransaction(tx.id, closerId, PRINCIPAL());
    expect(afterIssue[0].issued).toBe(true);
    expect(afterIssue[0].seq).toBe(1);
    expect(afterIssue[1].issued).toBe(false); // the second payout's voucher hasn't been viewed yet
  });

  it("never creates a voucher itself — issuing stays an explicit action", async () => {
    const tx = await mkTransaction("LISTNOWRITE", "No Write Client");
    const payout = await mkPayout("2097-03", new Date("2098-08-01"));
    await settleLine(tx.id, payout.id, "2097-03", 250);

    await listVouchersForTransaction(tx.id, closerId, PRINCIPAL());
    const count = await prisma.paymentVoucher.count({ where: { transactionId: tx.id, associateId: closerId } });
    expect(count).toBe(0);
  });
});

describe("listVouchersForTransactions (batched — A-6 Received tab)", () => {
  it("resolves each transaction's own vouchers with no cross-contamination, and a transaction with no settling payout comes back as an empty list, not a missing key", async () => {
    const txA = await mkTransaction("BATCHA", "Batch Client A");
    const payoutA = await mkPayout("2097-04", new Date("2098-09-01"));
    await settleLine(txA.id, payoutA.id, "2097-04", 500);

    const txB = await mkTransaction("BATCHB", "Batch Client B");
    const payoutB = await mkPayout("2097-05", new Date("2098-10-01"));
    await settleLine(txB.id, payoutB.id, "2097-05", 700);

    const txEmpty = await mkTransaction("BATCHEMPTY", "Batch Client Empty"); // no settling payout at all

    // txA's voucher is already issued; txB's and txEmpty's are not.
    await getOrCreateVoucher(txA.id, closerId, payoutA.id, PRINCIPAL());

    const result = await listVouchersForTransactions([txA.id, txB.id, txEmpty.id], closerId, PRINCIPAL());
    expect(result.size).toBe(3);

    const rowsA = result.get(txA.id)!;
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].payoutId).toBe(payoutA.id);
    expect(rowsA[0].issued).toBe(true);
    expect(rowsA[0].totalPaid).toBe("500.00");

    const rowsB = result.get(txB.id)!;
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].payoutId).toBe(payoutB.id); // never txA's payout — no cross-contamination
    expect(rowsB[0].issued).toBe(false);
    expect(rowsB[0].totalPaid).toBe("700.00");

    expect(result.get(txEmpty.id)).toEqual([]); // present, empty — not missing from the map
  });

  it("an already-issued voucher's totalPaid is FROZEN — a line Cancelled after issue doesn't move it, matching the PDF", async () => {
    const tx = await mkTransaction("FROZEN", "Frozen Client");
    const payout = await mkPayout("2097-06", new Date("2098-11-01"));
    await settleLine(tx.id, payout.id, "2097-06", 300);
    const issued = await getOrCreateVoucher(tx.id, closerId, payout.id, PRINCIPAL());
    expect(issued!.totalPaid.toFixed(2)).toBe("300.00");

    // A line on this payout is Cancelled AFTER the voucher was issued.
    await settleLine(tx.id, payout.id, "2097-06", 50, "Cancelled");

    const rows = (await listVouchersForTransactions([tx.id], closerId, PRINCIPAL())).get(tx.id)!;
    expect(rows[0].totalPaid).toBe("300.00"); // frozen, not recomputed to reflect the cancellation
  });

  it("listVouchersForTransaction (singular) is the same one code path as the batched version", async () => {
    const tx = await mkTransaction("SINGULAR", "Singular Client");
    const payout = await mkPayout("2097-07", new Date("2098-12-01"));
    await settleLine(tx.id, payout.id, "2097-07", 150);

    const single = await listVouchersForTransaction(tx.id, closerId, PRINCIPAL());
    const batched = (await listVouchersForTransactions([tx.id], closerId, PRINCIPAL())).get(tx.id)!;
    expect(single).toEqual(batched);
  });
});

// The read rule lives IN these functions, not only in the routes that call
// them — the batched list function exists precisely so a Server Component
// (A-6) can call it directly, bypassing a route-level check entirely.
// These prove the safety net holds even called directly, with no route in
// front of it, and that it refuses BEFORE anything is created (the IDOR
// mint-count assertion).
describe("VoucherAccessDenied — the read rule holds even called directly, with no route in front", () => {
  const otherPrincipal = () => ({ associateId: otherId, role: "SalesAssociate" as never });

  it("getOrCreateVoucher refuses a principal who isn't the owner or an admin, and mints nothing", async () => {
    const tx = await mkTransaction("DENYCREATE", "Deny Client");
    const payout = await mkPayout("2097-08", new Date("2099-01-01"));
    await settleLine(tx.id, payout.id, "2097-08", 100);

    await expect(getOrCreateVoucher(tx.id, closerId, payout.id, otherPrincipal())).rejects.toThrow(VoucherAccessDenied);
    expect(await prisma.paymentVoucher.count({ where: { transactionId: tx.id } })).toBe(0); // refused before anything was created
  });

  it("listVouchersForTransactions refuses a principal who isn't the owner or an admin — the exact path A-6's Server Component calls", async () => {
    const tx = await mkTransaction("DENYLIST", "Deny List Client");
    const payout = await mkPayout("2097-09", new Date("2099-01-02"));
    await settleLine(tx.id, payout.id, "2097-09", 100);

    await expect(listVouchersForTransactions([tx.id], closerId, otherPrincipal())).rejects.toThrow(VoucherAccessDenied);
  });

  it("an admin principal is never refused, without needing to specify their own associateId", async () => {
    const tx = await mkTransaction("ADMINOK", "Admin Client");
    const payout = await mkPayout("2097-10", new Date("2099-01-03"));
    await settleLine(tx.id, payout.id, "2097-10", 100);

    const adminPrincipal = { associateId: null, role: "Admin" as never };
    expect(await getOrCreateVoucher(tx.id, closerId, payout.id, adminPrincipal)).not.toBeNull();
    expect((await listVouchersForTransactions([tx.id], closerId, adminPrincipal)).get(tx.id)).toHaveLength(1);
  });
});
