// A-7 — the voucher routes. GET only RETRIEVES an already-issued voucher
// (401/403/404/200, never 404 -> creates); POST issues-or-returns it, gated
// by the same Origin check every other cookie-authenticated POST route
// handler uses. Real throwaway Postgres (needs DATABASE_URL); fake data
// only, cleaned up. app/** isn't in vitest's include globs, so this file
// (under server/) imports the route handlers directly rather than making
// an HTTP request — same pattern as B-7's ack-route tests.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));

import { prisma } from "@/lib/db";
import { GET, POST } from "@/app/portal/transactions/[id]/voucher/route";
import { GET as GET_LIST } from "@/app/portal/transactions/[id]/vouchers/route";

const TAG = "A7VOUCHERRT-";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const SAME_ORIGIN = { host: "x", origin: "http://x" };
const FOREIGN_ORIGIN = { host: "x", origin: "http://evil.example" };
let companyId = "", closerId = "", otherId = "";

async function mkSettledTransaction(code: string, payoutMonth: string) {
  const sub = await prisma.salesSubmission.create({
    data: { salesDate: new Date("2099-07-01"), clientName: TAG + code, saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 500 },
    select: { id: true },
  });
  const tx = await prisma.salesTransaction.create({
    data: { transactionCode: TAG + code, submissionId: sub.id, salesDate: new Date("2099-07-01"), clientName: TAG + code, saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 500 },
  });
  const payout = await prisma.monthlyPayout.create({
    data: { payoutMonth, associateId: closerId, seq: 0, kind: "Regular" as never, associateName: "Closer", designation: "SalesAssociate" as never, payoutStatus: "Paid" as never, totalPayable: 500, paidDate: new Date("2098-06-15") },
  });
  await prisma.commissionLedger.create({
    data: { transactionId: tx.id, payoutMonth, associateId: closerId, associateName: "Closer", lineType: "Personal" as never, basisAmount: 500, amount: 500, eligibility: "Eligible" as never, status: "Eligible" as never, payoutId: payout.id },
  });
  return { tx, payout };
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
  await prisma.paymentVoucher.deleteMany({ where: { associateId: { in: [closerId, otherId] } } });
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociateId: closerId } } });
  await prisma.monthlyPayout.deleteMany({ where: { associateId: closerId } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociateId: closerId } });
  await prisma.associate.deleteMany({ where: { id: { in: [closerId, otherId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

const callGet = (id: string, query = "", headers: Record<string, string> = {}) => GET(new Request(`http://x${query}`, { headers }), { params: Promise.resolve({ id }) });
const callPost = (id: string, query = "", headers: Record<string, string> = SAME_ORIGIN) =>
  POST(new Request(`http://x${query}`, { method: "POST", headers }), { params: Promise.resolve({ id }) });
const callList = (id: string, query = "") => GET_LIST(new Request(`http://x${query}`), { params: Promise.resolve({ id }) });

describe("GET /portal/transactions/[id]/voucher — retrieve only, never issues", () => {
  it("404 when nothing has been issued yet, even though the payout settled something for this associate", async () => {
    const { tx, payout } = await mkSettledTransaction("GETNOCREATE", "2098-09");
    who.session = { user: { associateId: closerId, id: "55555555-5555-5555-5555-555555555555", role: "SalesAssociate" } };

    expect((await callGet(tx.id, `?payoutId=${payout.id}`)).status).toBe(404);
    // Confirms it: GET really created nothing.
    expect(await prisma.paymentVoucher.count({ where: { transactionId: tx.id, payoutId: payout.id } })).toBe(0);
  });

  it("200 once POST has issued it, with the same content every time", async () => {
    const { tx, payout } = await mkSettledTransaction("GETAFTERPOST", "2098-10");
    who.session = { user: { associateId: closerId, id: "66666666-6666-6666-6666-666666666666", role: "SalesAssociate" } };

    await callPost(tx.id, `?payoutId=${payout.id}`);
    const res = await callGet(tx.id, `?payoutId=${payout.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await prisma.paymentVoucher.count({ where: { transactionId: tx.id, payoutId: payout.id } })).toBe(1); // still exactly one
  });

  // Carried over from the A-7 reference build's review history: a malformed
  // percent-escape in the locale cookie must fall back to the default
  // locale, not 500 the download.
  it("falls back to the default locale instead of 500ing on a malformed locale cookie", async () => {
    const { tx, payout } = await mkSettledTransaction("GETBADCOOKIE", "2098-12");
    who.session = { user: { associateId: closerId, id: "88888888-8888-8888-8888-888888888888", role: "SalesAssociate" } };
    await callPost(tx.id, `?payoutId=${payout.id}`);

    const res = await callGet(tx.id, `?payoutId=${payout.id}`, { cookie: "NEXT_LOCALE=%ZZ" }); // invalid percent-escape
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("401 anonymous, 403 a different associate (IDOR probe), 404 bad id / missing or unknown payoutId / nothing settled by it", async () => {
    const { tx, payout } = await mkSettledTransaction("GETOK", "2098-01");

    who.session = null;
    expect((await callGet(tx.id, `?payoutId=${payout.id}`)).status).toBe(401);

    who.session = { user: { associateId: otherId, id: "22222222-2222-2222-2222-222222222222", role: "SalesAssociate" } };
    expect((await callGet(tx.id, `?payoutId=${payout.id}`)).status).toBe(404); // own scope, nothing settled for them
    expect((await callGet(tx.id, `?payoutId=${payout.id}&associateId=${closerId}`)).status).toBe(403); // explicitly asking for the closer's

    who.session = { user: { associateId: closerId, id: "33333333-3333-3333-3333-333333333333", role: "SalesAssociate" } };
    expect((await callGet(tx.id)).status).toBe(404); // no payoutId at all
    expect((await callGet(tx.id, "?payoutId=not-a-uuid")).status).toBe(404);
    expect((await callGet(tx.id, "?payoutId=11111111-1111-1111-1111-111111111111")).status).toBe(404); // well-formed, no such payout
    expect((await callGet("not-a-uuid", `?payoutId=${payout.id}`)).status).toBe(404);
    expect((await callGet("11111111-1111-1111-1111-111111111111", `?payoutId=${payout.id}`)).status).toBe(404); // well-formed, no such transaction

    const unsettledSub = await prisma.salesSubmission.create({
      data: { salesDate: new Date("2099-07-01"), clientName: TAG + "UNSET", saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0 },
      select: { id: true },
    });
    const unsettled = await prisma.salesTransaction.create({
      data: { transactionCode: TAG + "UNSET", submissionId: unsettledSub.id, salesDate: new Date("2099-07-01"), clientName: TAG + "UNSET", saleAmount: 500, paymentPlan: "FullPayment" as never, closingAssociateId: closerId, amountCollected: 0 },
    });
    expect((await callGet(unsettled.id, `?payoutId=${payout.id}`)).status).toBe(404); // this payout settled nothing on THIS transaction
  });
});

describe("POST /portal/transactions/[id]/voucher — issues, or returns the already-issued one", () => {
  it("foreign or missing Origin -> 403 before auth, nothing created", async () => {
    const { tx, payout } = await mkSettledTransaction("POSTORIGIN", "2098-11");
    who.session = { user: { associateId: closerId, id: "77777777-7777-7777-7777-777777777777", role: "SalesAssociate" } };

    expect((await callPost(tx.id, `?payoutId=${payout.id}`, FOREIGN_ORIGIN)).status).toBe(403);
    expect((await callPost(tx.id, `?payoutId=${payout.id}`, { host: "x" })).status).toBe(403); // no Origin at all
    expect(await prisma.paymentVoucher.count({ where: { transactionId: tx.id, payoutId: payout.id } })).toBe(0);
  });

  it("401 anonymous, 403 a different associate (IDOR probe, mints nothing), 200 the owner and admin, 404 nothing settled / bad ids", async () => {
    const { tx, payout } = await mkSettledTransaction("POSTOK", "2098-03");

    who.session = null;
    expect((await callPost(tx.id, `?payoutId=${payout.id}`)).status).toBe(401);

    who.session = { user: { associateId: otherId, id: "22222222-2222-2222-2222-222222222222", role: "SalesAssociate" } };
    expect((await callPost(tx.id, `?payoutId=${payout.id}`)).status).toBe(404); // own scope, nothing settled for them
    expect((await callPost(tx.id, `?payoutId=${payout.id}&associateId=${closerId}`)).status).toBe(403); // IDOR probe
    // The deliverable: a refused IDOR probe must mint NOTHING. A refactor
    // that relocated the read-rule check to after the row is created would
    // still 403 here (the route's own catch), but a count above 0 would
    // catch that regression where the status code alone cannot.
    expect(await prisma.paymentVoucher.count({ where: { transactionId: tx.id, payoutId: payout.id } })).toBe(0);

    who.session = { user: { associateId: closerId, id: "33333333-3333-3333-3333-333333333333", role: "SalesAssociate" } };
    const okOwner = await callPost(tx.id, `?payoutId=${payout.id}`);
    expect(okOwner.status).toBe(200);
    expect(okOwner.headers.get("Content-Type")).toBe("application/pdf");
    expect(okOwner.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await prisma.paymentVoucher.count({ where: { transactionId: tx.id, payoutId: payout.id } })).toBe(1);

    // A second POST for the same payout returns the SAME voucher, not a second one.
    const okAgain = await callPost(tx.id, `?payoutId=${payout.id}`);
    expect(okAgain.status).toBe(200);
    expect(await prisma.paymentVoucher.count({ where: { transactionId: tx.id, payoutId: payout.id } })).toBe(1);

    who.session = ADMIN;
    expect((await callPost(tx.id, `?payoutId=${payout.id}&associateId=${closerId}`)).status).toBe(200); // admin has no own associateId — must specify whose

    who.session = { user: { associateId: closerId, id: "33333333-3333-3333-3333-333333333333", role: "SalesAssociate" } };
    expect((await callPost(tx.id)).status).toBe(404); // no payoutId at all
    expect((await callPost(tx.id, "?payoutId=not-a-uuid")).status).toBe(404);
    expect((await callPost(tx.id, "?payoutId=11111111-1111-1111-1111-111111111111")).status).toBe(404); // well-formed, no such payout
    expect((await callPost("not-a-uuid", `?payoutId=${payout.id}`)).status).toBe(404);
    expect((await callPost("11111111-1111-1111-1111-111111111111", `?payoutId=${payout.id}`)).status).toBe(404); // well-formed, no such transaction
  });
});

describe("GET /portal/transactions/[id]/vouchers (list)", () => {
  it("401 anonymous, 403 a different associate, 200 with the settling payouts for the owner and admin", async () => {
    const { tx, payout } = await mkSettledTransaction("LISTRT", "2098-02");

    who.session = null;
    expect((await callList(tx.id)).status).toBe(401);

    who.session = { user: { associateId: otherId, id: "44444444-4444-4444-4444-444444444444", role: "SalesAssociate" } };
    expect((await callList(tx.id, `?associateId=${closerId}`)).status).toBe(403);

    who.session = { user: { associateId: closerId, id: "33333333-3333-3333-3333-333333333333", role: "SalesAssociate" } };
    const res = await callList(tx.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vouchers).toHaveLength(1);
    expect(body.vouchers[0].payoutId).toBe(payout.id);
    expect(body.vouchers[0].issued).toBe(false);

    who.session = ADMIN;
    const asAdmin = await callList(tx.id, `?associateId=${closerId}`);
    expect(asAdmin.status).toBe(200);
    expect((await asAdmin.json()).vouchers).toHaveLength(1);
  });
});
