// B-7 (DevSecOps K4, owner ruling): the ack-serving routes — 401 (no
// session), 404 (malformed id / no ack yet), 200 with nosniff + inline
// disposition for admin/Accounts, the closing associate, and their direct/2nd
// upline — and 403 for everyone else, which is the deliverable this file
// exists to prove, not the happy path. Real throwaway Postgres (needs
// DATABASE_URL); fake data only, cleaned up. app/** isn't in vitest's
// include globs, so this test file (under server/) imports the route
// handlers directly rather than making an HTTP request.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));

import { prisma } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { GET as invoiceAckGet } from "@/app/admin/invoices/[id]/ack/route";
import { GET as installmentAckGet } from "@/app/admin/invoices/installments/[id]/ack/route";

const TAG = "B7ACKRT-";
const BUSINESS_ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const ACCOUNTS = { user: { associateId: null, id: "22222222-2222-2222-2222-222222222222", role: "Accounts" } };
const ASSOCIATE = { user: { associateId: "33333333-3333-3333-3333-333333333333", id: "44444444-4444-4444-4444-444444444444", role: "SalesAssociate" } };
let companyId = "", directUplineId = "", secondUplineId = "", closerId = "";

function asAssociate(associateId: string) {
  return { user: { associateId, id: "55555555-5555-5555-5555-555555555555", role: "SalesAssociate" } };
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  secondUplineId = (await prisma.associate.create({
    data: { associateCode: TAG + "U2", fullName: "Second Upline", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
  directUplineId = (await prisma.associate.create({
    data: { associateCode: TAG + "U1", fullName: "Direct Upline", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never, directUplineId: secondUplineId },
    select: { id: true },
  })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never, directUplineId, secondUplineId },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  await prisma.installmentSchedule.deleteMany({ where: { plan: { transaction: { closingAssociateId: closerId } } } });
  await prisma.installmentPlan.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.invoice.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.associate.deleteMany({ where: { id: directUplineId } });
  await prisma.associate.deleteMany({ where: { id: secondUplineId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

let n = 0;
async function mkTransactionWithAck() {
  const code = TAG + "TXN" + ++n;
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2099-08-01"), clientName: TAG + "C", saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 500 },
    select: { id: true },
  });
  const tx = await prisma.salesTransaction.create({
    data: { transactionCode: code, submissionId: sub.id, salesDate: new Date("2099-08-01"), clientName: TAG + "C", saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 500 },
  });
  const key = `payment-acks/route-test/${code}.pdf`;
  await putObject(key, Buffer.from("%PDF-1.4\ntest\n"));
  const invoice = await prisma.invoice.create({ data: { transactionId: tx.id, companyId, invoiceNumber: code, amount: 500, status: "Paid" as never, paymentAckFileKey: key } });
  const plan = await prisma.installmentPlan.create({ data: { transactionId: tx.id, totalAmount: 500, deposit: 0, installmentCount: 1 } });
  const schedule = await prisma.installmentSchedule.create({ data: { planId: plan.id, sequence: 1, dueAmount: 500, paid: true, paymentAckFileKey: key } });
  return { invoice, schedule };
}

describe.each([
  ["invoice ack route", () => invoiceAckGet, (id: string) => invoiceAckGet(new Request("http://x"), { params: Promise.resolve({ id }) })],
  ["installment ack route", () => installmentAckGet, (id: string) => installmentAckGet(new Request("http://x"), { params: Promise.resolve({ id }) })],
])("%s", (_label, _getFn, call) => {
  it("401 with no session, 200 for admin and Accounts, 404 for a bad id", async () => {
    const { invoice, schedule } = await mkTransactionWithAck();
    const id = _label === "invoice ack route" ? invoice.id : schedule.id;

    who.session = null;
    expect((await call(id)).status).toBe(401);

    who.session = BUSINESS_ADMIN;
    const okAdmin = await call(id);
    expect(okAdmin.status).toBe(200);
    expect(okAdmin.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(okAdmin.headers.get("Content-Disposition")).toMatch(/^inline/);

    who.session = ACCOUNTS;
    expect((await call(id)).status).toBe(200);

    who.session = BUSINESS_ADMIN;
    expect((await call("not-a-uuid")).status).toBe(404);
    expect((await call("11111111-1111-1111-1111-111111111111")).status).toBe(404); // well-formed, no such row
  });

  it("200 for the closing associate, their direct upline, and their 2nd upline", async () => {
    const { invoice, schedule } = await mkTransactionWithAck();
    const id = _label === "invoice ack route" ? invoice.id : schedule.id;

    for (const viewer of [closerId, directUplineId, secondUplineId]) {
      who.session = asAssociate(viewer);
      expect((await call(id)).status).toBe(200);
    }
  });

  // 🔑 The deliverable: an access-control change tested only on success isn't
  // tested. A SALES ASSOCIATE WHO IS NEITHER THE CLOSER NOR THEIR UPLINE —
  // not an admin, not related to this sale at all — must be refused.
  it("403 for a non-upline associate (the refusal this access-control change exists to enforce)", async () => {
    const { invoice, schedule } = await mkTransactionWithAck();
    const id = _label === "invoice ack route" ? invoice.id : schedule.id;

    who.session = ASSOCIATE; // unrelated to closerId/directUplineId/secondUplineId
    expect((await call(id)).status).toBe(403);
  });
});
