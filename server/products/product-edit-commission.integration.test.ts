// Editing a product's commission structure must never move money already earned.
//
// What protects it (measured, not assumed): the engine pays from the
// CommissionStructureVersion a sale line was resolved to when it was verified
// (server/commission/run.ts reads `li.structureVersion.rateSnapshot`), never from
// the product row. updateProduct therefore writes a NEW version for a rate
// change and never edits an old one. This file runs the real money path end to
// end — createProduct, submit, approve, close, mark paid, payout run — changes
// every rate through updateProduct, and asserts every previously-computed
// figure is identical, including after the commission is RECOMPUTED and the
// payout month RE-RUN (the paths that would expose a live read of the product).
//
// Real Postgres, real auditTx (updateProduct's audit rows are asserted here).
// Fake data only; every row tagged and cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// submitSale reads the ambient A17_CLOSED_DEAL_FLOW; forced off so this file is
// steered by no ambient config (same fixture-scaffolding reason as the payout tests).
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), env: { ...(await orig<typeof import("@/lib/env")>()).env, A17_CLOSED_DEAL_FLOW: false } }));

import { prisma } from "@/lib/db";
import { fakePdfFile } from "@/lib/test-fixtures";
import { submitSale, approveQuotation, approveSubmissionSplit, adminApproveSplit, closeSale } from "@/server/sales/actions";
import { markInvoicePaid } from "@/server/invoices/actions";
import { runPayouts } from "@/server/payouts/actions";
import { runCommission } from "@/server/commission/run";
import { resolveSaleLines } from "@/server/sales/resolve-sale-lines";
import { createProduct, updateProduct, type ProductInput } from "./actions";
import { VERSION_RESOLUTION_ORDER } from "@/server/commission/version-order";
import { earliestRateChangeDate } from "./commission-edit";
import { addDays, format } from "date-fns";
import type { ProductDetailsRawInput } from "@/lib/schemas";

const TAG = "PRODRATE-";
const CODE = TAG + "P1";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
const ACCOUNTS = { user: { associateId: null, id: "33333333-3333-3333-3333-333333333333", role: "Accounts" } };

// Dates in a year no other test file uses (payout queries look across months).
const OLD_EFFECTIVE = "2098-01-01";
const NEW_EFFECTIVE = "2098-04-01";
const MARCH = "2098-03";
const APRIL = "2098-04";

const OLD_RATES = { commissionType: "Percentage" as const, closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3", isExternal: false, effectiveDate: OLD_EFFECTIVE };
const NEW_RATES = { commissionType: "Percentage" as const, closingCommPct: "20", companyCutPct: "4", smOverridePct: "9", sdOverridePct: "6", isExternal: false, effectiveDate: NEW_EFFECTIVE };
const PRICING = { listedPrice: "10000.00", instalmentOption: "None" as const };

let companyId = "", productId = "", sdId = "", smId = "", closerId = "";

async function mkAssoc(code: string, designation: string, direct: string | null, second: string | null) {
  return (await prisma.associate.create({
    data: {
      associateCode: TAG + code, fullName: code, designation: designation as never,
      directUplineId: direct, secondUplineId: second,
      approvalStatus: "Approved" as never, associateStatus: "Active" as never,
    },
    select: { id: true },
  })).id;
}

/** Submit, with the rep's session. Returns the submission id. */
async function submit(salesDate: string, amount: number, pid: string = productId) {
  who.session = { user: { associateId: closerId, id: "sess-closer" } };
  expect((await submitSale({
    salesDate, clientName: TAG + "Client", paymentPlan: "Full Payment",
    lines: [{ productId: pid, lineSaleAmount: amount, comCodeIds: [] }],
  } as never)).ok).toBe(true);
  return (await prisma.salesSubmission.findFirstOrThrow({
    where: { closingAssociateId: closerId, salesDate: new Date(salesDate) }, orderBy: { createdAt: "desc" }, select: { id: true },
  })).id;
}

/** Approve → close (verify: resolves the rate version) → mark paid (ledger goes Eligible). */
async function closeAndPay(subId: string, ref: string) {
  who.session = ADMIN;
  expect((await approveSubmissionSplit(subId)).ok).toBe(true);
  expect((await adminApproveSplit(subId)).ok).toBe(true);
  expect((await approveQuotation(subId)).ok).toBe(true);
  await prisma.submissionDocument.create({ data: { submissionId: subId, kind: "Signed", fileKey: TAG + ref + ".pdf", fileName: "signed.pdf" } });
  expect((await closeSale(subId)).ok).toBe(true);
  const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: subId } });
  const inv = await prisma.invoice.findFirstOrThrow({ where: { transactionId: tx.id } });
  expect((await markInvoicePaid(inv.id, fakePdfFile(), { method: "Bank", reference: TAG + ref })).ok).toBe(true);
  return tx.id;
}

/** Every commission figure of a transaction, in a stable order, minus row ids
 *  (a recompute deletes and re-creates rows, so ids legitimately change). */
async function ledgerOf(transactionId: string) {
  const rows = await prisma.commissionLedger.findMany({ where: { transactionId } });
  return rows
    .map((l) => ({
      associateId: l.associateId, lineType: l.lineType, comCode: l.comCode,
      basis: l.basisAmount?.toFixed(2) ?? null, rate: l.rateOrValue?.toString() ?? null,
      amount: l.amount.toFixed(2), status: l.status, payoutMonth: l.payoutMonth,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
const payoutsOf = async (month: string) =>
  (await prisma.monthlyPayout.findMany({ where: { payoutMonth: month, associate: { associateCode: { startsWith: TAG } } } }))
    .map((p) => ({ associateId: p.associateId, seq: p.seq, status: p.payoutStatus, personal: p.personalCommission.toFixed(2), total: p.totalPayable.toFixed(2) }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const closerNet = async (transactionId: string) =>
  (await prisma.commissionLedger.findMany({ where: { transactionId, associateId: closerId } })).reduce((n, l) => n + Number(l.amount), 0);
const versionsOf = () => prisma.commissionStructureVersion.findMany({ where: { productCode: CODE }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] });

const edit = (rates: object, extra: Partial<ProductDetailsRawInput> = {}) =>
  updateProduct(productId, { productName: "Rate edit product", defaultCompanyId: companyId, ...rates, ...PRICING, ...extra } as ProductDetailsRawInput);

let txA = "", subC = "";
let ledgerA: Awaited<ReturnType<typeof ledgerOf>> = [], payoutsMarch: Awaited<ReturnType<typeof payoutsOf>> = [];
let versionAId = "", versionAJson = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  who.session = ADMIN;
  expect(await createProduct({ productCode: CODE, productName: "Rate edit product", defaultCompanyId: companyId, ...OLD_RATES, ...PRICING } as ProductInput)).toEqual({ ok: true });
  productId = (await prisma.product.findFirstOrThrow({ where: { productCode: CODE } })).id;
  sdId = await mkAssoc("SD", "SalesDirector", null, null);
  smId = await mkAssoc("SM", "SalesManager", sdId, null);
  closerId = await mkAssoc("CL", "SalesAssociate", smId, sdId);
});

afterAll(async () => {
  const mine = { associateCode: { startsWith: TAG } };
  await prisma.commissionLedger.deleteMany({ where: { transaction: { closingAssociate: mine } } });
  await prisma.monthlyPayout.deleteMany({ where: { associate: mine } });
  await prisma.invoice.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.saleLineItem.deleteMany({ where: { company: { invoicePrefix: { startsWith: TAG } } } });
  await prisma.salesTransaction.deleteMany({ where: { closingAssociate: mine } });
  await prisma.submissionDocument.deleteMany({ where: { fileKey: { startsWith: TAG } } });
  await prisma.salesSubmission.deleteMany({ where: { closingAssociate: mine } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: mine });
  await prisma.company.deleteMany({ where: { invoicePrefix: { startsWith: TAG } } });
});

describe("a rate edit never moves commission already computed", () => {
  it("baseline: a sale under the OLD rates is closed, paid and run into a payout", async () => {
    txA = await closeAndPay(await submit(MARCH + "-10", 10000), "A");
    // A second sale is submitted now but closed only AFTER the edit (case below).
    subC = await submit(MARCH + "-20", 10000);
    who.session = ADMIN;
    expect((await runPayouts(MARCH)).ok).toBe(true);

    ledgerA = await ledgerOf(txA);
    payoutsMarch = await payoutsOf(MARCH);
    expect(ledgerA.length).toBeGreaterThan(0);
    // Old rates: closing 10% of 10000 = 1000, less 2% company cut = 800 to the closer.
    expect(await closerNet(txA)).toBeCloseTo(800, 2);
    const v = await versionsOf();
    expect(v).toHaveLength(1);
    versionAId = v[0].id;
    versionAJson = JSON.stringify(v[0].rateSnapshot);
    // The line is linked to that version — the thing the engine reads.
    expect((await prisma.saleLineItem.findFirstOrThrow({ where: { transactionId: txA } })).structureVersionId).toBe(versionAId);
  });

  it("the edit goes through, and really does change every rate on the product row", async () => {
    who.session = ADMIN;
    expect(await edit(NEW_RATES)).toEqual({ ok: true });
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(p.closingCommPct?.toFixed(4)).toBe("20.0000");
    expect(p.companyCutPct.toFixed(4)).toBe("4.0000");
    expect(p.smOverridePct.toFixed(4)).toBe("9.0000");
    expect(p.sdOverridePct.toFixed(4)).toBe("6.0000");
    expect(p.effectiveDate.toISOString().slice(0, 10)).toBe(NEW_EFFECTIVE);
  });

  it("the old version row is untouched and a NEW version was added beside it", async () => {
    const v = await versionsOf();
    expect(v).toHaveLength(2);
    expect(v[0].id).toBe(versionAId);
    expect(JSON.stringify(v[0].rateSnapshot)).toBe(versionAJson);
    expect(v[1].effectiveDate.toISOString().slice(0, 10)).toBe(NEW_EFFECTIVE);
    expect(v[1].rateSnapshot).toMatchObject({ closingCommPct: "20", companyCutPct: "4", smOverridePct: "9", sdOverridePct: "6" });
  });

  it("EVERY previously computed ledger figure is identical after the edit", async () => {
    expect(await ledgerOf(txA)).toEqual(ledgerA);
    expect(await closerNet(txA)).toBeCloseTo(800, 2);
  });

  it("…and after the commission is RECOMPUTED (the path that would expose a live read of the product)", async () => {
    who.session = ADMIN;
    await runCommission(txA, ADMIN.user.id);
    expect(await ledgerOf(txA)).toEqual(ledgerA);
  });

  it("…and after the payout month is RE-RUN, the payout totals are identical", async () => {
    who.session = ADMIN;
    expect((await runPayouts(MARCH)).ok).toBe(true);
    expect(await payoutsOf(MARCH)).toEqual(payoutsMarch);
    expect(await ledgerOf(txA)).toEqual(ledgerA);
  });

  it("a sale submitted BEFORE the edit with a sales date BEFORE the new effective date, closed AFTER it, still pays at the OLD rates", async () => {
    const txC = await closeAndPay(subC, "C");
    expect(await closerNet(txC)).toBeCloseTo(800, 2);
    expect((await prisma.saleLineItem.findFirstOrThrow({ where: { transactionId: txC } })).structureVersionId).toBe(versionAId);
  });

  it("a same-day CORRECTION (same effective date as the latest version) is accepted, and resolves to the newest version", async () => {
    who.session = ADMIN;
    // The 20% was a typo; the owner wants 22%, effective the same day.
    expect(await edit({ ...NEW_RATES, closingCommPct: "22" })).toEqual({ ok: true });
    const v = await versionsOf();
    expect(v).toHaveLength(3);
    expect(v[1].effectiveDate.toISOString()).toBe(v[2].effectiveDate.toISOString()); // a genuine same-date tie
    expect(v[2].rateSnapshot).toMatchObject({ closingCommPct: "22" });
  });

  it("positive control: a sale dated on/after the new effective date pays at the CORRECTED new rates (so the edit took effect, and the checks above are not vacuous)", async () => {
    const txB = await closeAndPay(await submit(APRIL + "-10", 10000), "B");
    // Corrected rates: closing 22% of 10000 = 2200, less 4% company cut = 1800 to the closer.
    expect(await closerNet(txB)).toBeCloseTo(1800, 2);
    const newVersion = (await versionsOf())[2];
    expect((await prisma.saleLineItem.findFirstOrThrow({ where: { transactionId: txB } })).structureVersionId).toBe(newVersion.id);
    // …while the old sale's figures still have not moved.
    expect(await ledgerOf(txA)).toEqual(ledgerA);
  });

  it("detector control: the engine ignores the product row — rewriting its commission columns with NO new version moves nothing…", async () => {
    await prisma.product.update({ where: { id: productId }, data: { closingCommPct: "50", companyCutPct: "30" } });
    who.session = ADMIN;
    await runCommission(txA, ADMIN.user.id);
    expect(await ledgerOf(txA)).toEqual(ledgerA);
  });

  it("…but editing the VERSION row the line points at DOES move it, so this file can fail (and the engine's real source is the version)", async () => {
    const original = (await prisma.commissionStructureVersion.findUniqueOrThrow({ where: { id: versionAId } })).rateSnapshot;
    try {
      await prisma.commissionStructureVersion.update({ where: { id: versionAId }, data: { rateSnapshot: { ...(original as object), closingCommPct: "12" } as never } });
      who.session = ADMIN;
      await runCommission(txA, ADMIN.user.id);
      expect(await ledgerOf(txA)).not.toEqual(ledgerA);
    } finally {
      await prisma.commissionStructureVersion.update({ where: { id: versionAId }, data: { rateSnapshot: original as never } });
      await runCommission(txA, ADMIN.user.id);
    }
    expect(await ledgerOf(txA)).toEqual(ledgerA);
  });
});

describe("updateProduct — commission edits: gate, rules, versioning, audit", () => {
  let id = "";
  const code = TAG + "P2";
  const mk = async (c: string, rates = OLD_RATES) => {
    who.session = ADMIN;
    expect(await createProduct({ productCode: c, productName: "Edit rules", ...rates, ...PRICING } as ProductInput)).toEqual({ ok: true });
    return (await prisma.product.findFirstOrThrow({ where: { productCode: c } })).id;
  };
  const upd = (pid: string, rates: object, extra: Partial<ProductDetailsRawInput> = {}) =>
    updateProduct(pid, { productName: "Edit rules", ...rates, ...PRICING, ...extra } as ProductDetailsRawInput);
  const versionCount = (c: string) => prisma.commissionStructureVersion.count({ where: { productCode: c } });

  beforeAll(async () => { id = await mk(code); });

  it("Accounts (not manage_products) is refused and nothing changes", async () => {
    who.session = ACCOUNTS;
    expect(await upd(id, NEW_RATES)).toEqual({ ok: false, error: "forbidden" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).closingCommPct?.toFixed(4)).toBe("10.0000");
    expect(await versionCount(code)).toBe(1);
  });

  it("an edit that leaves the commission fields as they are writes NO version and no rates_changed audit", async () => {
    who.session = ADMIN;
    expect(await upd(id, OLD_RATES, { productName: "Renamed" })).toEqual({ ok: true });
    expect(await versionCount(code)).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "product.rates_changed" } })).toBe(0);
  });

  it("the same cross-field rules as create: a Percentage product with no closing % is refused", async () => {
    who.session = ADMIN;
    const bad = { ...NEW_RATES, closingCommPct: undefined };
    expect(await upd(id, bad)).toEqual({ ok: false, error: "closingPctRequired" });
    expect(await upd(id, { ...NEW_RATES, commissionType: "Fixed", closingCommFixed: undefined })).toEqual({ ok: false, error: "closingFixedRequired" });
    expect(await versionCount(code)).toBe(1);
  });

  it("the shared pricing refine applies on edit: closing basis DiscountedPrice without a discount is refused", async () => {
    who.session = ADMIN;
    expect(await upd(id, NEW_RATES, { closingBasis: "DiscountedPrice" })).toEqual({ ok: false, error: "invalidInput" });
    expect(await versionCount(code)).toBe(1);
  });

  it("an unparseable effective date is refused, not a database error", async () => {
    who.session = ADMIN;
    expect(await upd(id, { ...NEW_RATES, effectiveDate: "not-a-date" })).toEqual({ ok: false, error: "invalidInput" });
  });

  it("a rate change may not take effect EARLIER than the latest version (a future date, so the floor is not what refuses it); nothing is written", async () => {
    who.session = ADMIN;
    expect(await upd(id, { ...NEW_RATES, effectiveDate: "2097-06-01" })).toEqual({ ok: false, error: "effectiveDateBeforeLatestVersion" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).closingCommPct?.toFixed(4)).toBe("10.0000");
    expect(await versionCount(code)).toBe(1);
  });

  it("a valid rate change writes one new version and audits what changed (before, after, changed fields, version id)", async () => {
    who.session = ADMIN;
    expect(await upd(id, NEW_RATES)).toEqual({ ok: true });
    expect(await versionCount(code)).toBe(2);
    const newVersion = (await prisma.commissionStructureVersion.findMany({ where: { productCode: code }, orderBy: { effectiveDate: "desc" } }))[0];

    const rates = await prisma.auditLog.findMany({ where: { entityId: id, action: "product.rates_changed" } });
    expect(rates).toHaveLength(1);
    expect(rates[0].actorUserId).toBe(ADMIN.user.id);
    expect(rates[0].beforeJson).toMatchObject({ rates: { closingCommPct: "10.0000", companyCutPct: "2.0000", smOverridePct: "5.0000", sdOverridePct: "3.0000", effectiveDate: OLD_EFFECTIVE } });
    expect(rates[0].afterJson).toMatchObject({
      rates: { closingCommPct: "20.0000", companyCutPct: "4.0000", smOverridePct: "9.0000", sdOverridePct: "6.0000", effectiveDate: NEW_EFFECTIVE },
      rateVersionId: newVersion.id,
    });
    expect((rates[0].afterJson as { changedRates: string[] }).changedRates.sort()).toEqual(["closingCommPct", "companyCutPct", "effectiveDate", "sdOverridePct", "smOverridePct"]);

    const details = await prisma.auditLog.findMany({ where: { entityId: id, action: "product.details_updated" }, orderBy: { createdAt: "desc" } });
    expect(details[0].beforeJson).toMatchObject({ rates: { closingCommPct: "10.0000" } });
    expect(details[0].afterJson).toMatchObject({ rates: { closingCommPct: "20.0000" }, rateVersionId: newVersion.id });
  });

  it("every other commission field is editable too (type, fixed amount, absolute cut/overrides, external + retained %)", async () => {
    who.session = ADMIN;
    const fixed = { commissionType: "Fixed" as const, closingCommFixed: "1500.00", companyCutPct: "100", companyCutType: "Absolute" as const, smOverridePct: "50", smOverrideType: "Absolute" as const, sdOverridePct: "25", sdOverrideType: "Absolute" as const, isExternal: false, effectiveDate: "2098-06-01" };
    expect(await upd(id, fixed)).toEqual({ ok: true });
    let p = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(p).toMatchObject({ commissionType: "Fixed", companyCutType: "Absolute", smOverrideType: "Absolute", sdOverrideType: "Absolute", closingCommPct: null });
    expect(p.closingCommFixed?.toFixed(2)).toBe("1500.00");
    expect(await versionCount(code)).toBe(3);

    expect(await upd(id, { ...NEW_RATES, isExternal: true, externalCompanyRetainedPct: "7.5", effectiveDate: "2098-07-01" })).toEqual({ ok: true });
    p = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(p.isExternal).toBe(true);
    expect(p.externalCompanyRetainedPct?.toFixed(4)).toBe("7.5000");
    expect(await versionCount(code)).toBe(4);
    const latest = (await prisma.commissionStructureVersion.findMany({ where: { productCode: code }, orderBy: { effectiveDate: "desc" } }))[0];
    expect(latest.rateSnapshot).toMatchObject({ isExternal: true, externalCompanyRetainedPct: "7.5" });
  });

  it("a same-day correction (same effective date as the latest version) is accepted and the newest version wins", async () => {
    who.session = ADMIN;
    const day = "2098-07-01"; // the latest version's date after the test above
    expect(await upd(id, { ...NEW_RATES, closingCommPct: "21", isExternal: false, effectiveDate: day })).toEqual({ ok: true });
    const versions = await prisma.commissionStructureVersion.findMany({ where: { productCode: code, effectiveDate: new Date(day) }, orderBy: { createdAt: "asc" } });
    expect(versions).toHaveLength(2);
    // The resolution order every site uses returns the corrected one.
    const resolved = await prisma.commissionStructureVersion.findFirstOrThrow({ where: { productCode: code, effectiveDate: { lte: new Date(day) } }, orderBy: [...VERSION_RESOLUTION_ORDER] });
    expect(resolved.id).toBe(versions[1].id);
    expect(resolved.rateSnapshot).toMatchObject({ closingCommPct: "21" });
  });

  it("FLOOR: a rate change may not be backdated — yesterday is refused, today (the floor) is accepted", async () => {
    const pastCode = TAG + "P3";
    const pid = await mk(pastCode, { ...OLD_RATES, effectiveDate: "2020-01-01" }); // creating in the past is allowed; changing rates is not
    const floor = earliestRateChangeDate();
    const dayBefore = format(addDays(new Date(floor), -1), "yyyy-MM-dd");
    expect(await upd(pid, { ...NEW_RATES, effectiveDate: dayBefore })).toEqual({ ok: false, error: "effectiveDateInPast" });
    expect(await upd(pid, { ...NEW_RATES, effectiveDate: "2021-01-01" })).toEqual({ ok: false, error: "effectiveDateInPast" });
    expect(await versionCount(pastCode)).toBe(1);
    expect(await upd(pid, { ...NEW_RATES, effectiveDate: floor })).toEqual({ ok: true });
    expect(await versionCount(pastCode)).toBe(2);
  });

  it("the floor binds only RATE changes: renaming a product whose effective date is long past still works", async () => {
    const pid = (await prisma.product.findFirstOrThrow({ where: { productCode: TAG + "P3" } })).id;
    const row = await prisma.product.findUniqueOrThrow({ where: { id: pid } });
    const same = { ...NEW_RATES, effectiveDate: row.effectiveDate.toISOString().slice(0, 10) };
    expect(await upd(pid, same, { productName: "Renamed, rates untouched" })).toEqual({ ok: true });
    expect(await versionCount(TAG + "P3")).toBe(2);
  });

  it("productCode stays immutable on a commission edit too", async () => {
    who.session = ADMIN;
    expect(await upd(id, NEW_RATES, { productCode: TAG + "HIJACK" } as never)).toEqual({ ok: false, error: "invalidInput" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).productCode).toBe(code);
  });
});

describe("updateProduct — pre-existing invalid commission data never blocks an edit that does not touch the commission", () => {
  const base = { companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3", effectiveDate: new Date("2020-01-01") };
  /** What the edit form sends for an untouched commission block (edit/page.tsx's
   *  initial values: Decimal.toString(), nulls as undefined, dates as yyyy-mm-dd). */
  const asForm = (r: Awaited<ReturnType<typeof prisma.product.findUniqueOrThrow>>) => ({
    commissionType: r.commissionType, closingCommPct: r.closingCommPct?.toString(), closingCommFixed: r.closingCommFixed?.toFixed(2),
    companyCutPct: r.companyCutPct.toString(), companyCutType: r.companyCutType, smOverridePct: r.smOverridePct.toString(), smOverrideType: r.smOverrideType,
    sdOverridePct: r.sdOverridePct.toString(), sdOverrideType: r.sdOverrideType, isExternal: r.isExternal,
    externalCompanyRetainedPct: r.externalCompanyRetainedPct?.toString(), effectiveDate: r.effectiveDate.toISOString().slice(0, 10),
  });
  const seed = (suffix: string, extra: object) =>
    prisma.product.create({ data: { productCode: TAG + suffix, productName: "Legacy", commissionType: "Percentage", ...base, listedPrice: "100.00", instalmentOption: "None", ...extra } });
  const rename = (r: Awaited<ReturnType<typeof seed>>, name: string) =>
    updateProduct(r.id, { productName: name, ...asForm(r), listedPrice: "100.00", instalmentOption: "None" } as ProductDetailsRawInput);
  const after = async (r: { id: string }) => ({
    row: await prisma.product.findUniqueOrThrow({ where: { id: r.id } }),
    versions: await prisma.commissionStructureVersion.count({ where: { productId: r.id } }),
    rateAudits: await prisma.auditLog.count({ where: { entityId: r.id, action: "product.rates_changed" } }),
  });

  it("external product with a NULL closing %: a name-only edit succeeds, the stored commission is left exactly as it was, no version", async () => {
    who.session = ADMIN;
    const r = await seed("LEG1", { isExternal: true, externalCompanyRetainedPct: "5", closingCommPct: null });
    expect(await rename(r, "Renamed legacy")).toEqual({ ok: true });
    const a = await after(r);
    expect(a.row.productName).toBe("Renamed legacy");
    expect(a.row.closingCommPct).toBeNull();
    expect(a.row.effectiveDate.toISOString()).toBe(r.effectiveDate.toISOString()); // a 2020 date: the floor never applies to a rename
    expect(a.versions).toBe(0);
    expect(a.rateAudits).toBe(0);
  });

  it("a non-external Percentage product with a null closing % is the same", async () => {
    who.session = ADMIN;
    const r = await seed("LEG2", { closingCommPct: null });
    expect(await rename(r, "Renamed too")).toEqual({ ok: true });
    expect((await after(r)).row.productName).toBe("Renamed too");
  });

  it("legacy leftovers do not read as an edit: an external product with NO retained % and a stale fixed amount on a Percentage product", async () => {
    who.session = ADMIN;
    const ext = await seed("LEG3", { isExternal: true, externalCompanyRetainedPct: null, closingCommPct: "0" });
    const stale = await seed("LEG4", { closingCommPct: "10", closingCommFixed: "123.00" });
    expect(await rename(ext, "Ext renamed")).toEqual({ ok: true });
    expect(await rename(stale, "Stale renamed")).toEqual({ ok: true });
    for (const r of [ext, stale]) {
      const a = await after(r);
      expect(a.versions).toBe(0);
      expect(a.rateAudits).toBe(0);
    }
    expect((await after(ext)).row.externalCompanyRetainedPct).toBeNull(); // not rewritten to 0
    expect((await after(stale)).row.closingCommFixed?.toFixed(2)).toBe("123.00");
  });

  it("but CHANGING the commission of such a product is validated as on create: no closing % → refused; with one (and a valid date) → accepted", async () => {
    who.session = ADMIN;
    const r = await seed("LEG5", { isExternal: true, externalCompanyRetainedPct: "5", closingCommPct: null });
    const form = { ...asForm(r), effectiveDate: earliestRateChangeDate() };
    const send = (c: object) => updateProduct(r.id, { productName: "Legacy", ...form, ...c, listedPrice: "100.00", instalmentOption: "None" } as ProductDetailsRawInput);
    expect(await send({ externalCompanyRetainedPct: "6" })).toEqual({ ok: false, error: "closingPctRequired" });
    expect((await after(r)).versions).toBe(0);
    expect(await send({ externalCompanyRetainedPct: "6", closingCommPct: "0" })).toEqual({ ok: true });
    expect((await after(r)).versions).toBe(1);
  });
});

describe("a sale's line shape comes from the version in force on its sales date (the type flip that used to block closing)", () => {
  const code = TAG + "P4";
  let pid = "";
  const lineOf = async (transactionId: string) => prisma.saleLineItem.findFirstOrThrow({ where: { transactionId } });
  const ledgerAmounts = async (transactionId: string) => (await prisma.commissionLedger.findMany({ where: { transactionId } })).map((l) => ({ type: l.lineType, amount: Number(l.amount), who: l.associateId }));

  beforeAll(async () => {
    who.session = ADMIN;
    expect(await createProduct({ productCode: code, productName: "Flip", defaultCompanyId: companyId, ...OLD_RATES, ...PRICING } as ProductInput)).toEqual({ ok: true });
    pid = (await prisma.product.findFirstOrThrow({ where: { productCode: code } })).id;
    // Percentage -> Fixed, effective 2098-06-01 (future), made BEFORE the sales below are submitted.
    const fixed = { commissionType: "Fixed" as const, closingCommFixed: "1500", companyCutPct: "200", companyCutType: "Absolute" as const, smOverridePct: "50", smOverrideType: "Absolute" as const, sdOverridePct: "30", sdOverrideType: "Absolute" as const, isExternal: false, effectiveDate: "2098-06-01" };
    expect(await updateProduct(pid, { productName: "Flip", defaultCompanyId: companyId, ...fixed, ...PRICING } as ProductDetailsRawInput)).toEqual({ ok: true });
  });

  it("a sale dated 2098-03-10 submitted AFTER the edit: no split warning, line is Percentage, closes without a split exception, no negative Personal line, old rates (800)", async () => {
    who.session = { user: { associateId: closerId, id: "55555555-5555-5555-5555-555555555555" } };
    const r = await submitSale({ salesDate: "2098-03-10", clientName: TAG + "Client", paymentPlan: "Full Payment", lines: [{ productId: pid, lineSaleAmount: 10000, comCodeIds: [] }] } as never);
    expect(r).toMatchObject({ ok: true });
    expect((r as { warning?: unknown }).warning).toBeUndefined(); // previously: splitExceedsNet, Personal -200.00
    const sub = (r as { id: string }).id;
    who.session = ADMIN;
    expect((await approveSubmissionSplit(sub)).ok).toBe(true);
    expect((await adminApproveSplit(sub)).ok).toBe(true);
    expect((await approveQuotation(sub)).ok).toBe(true);
    await prisma.submissionDocument.create({ data: { submissionId: sub, kind: "Signed", fileKey: TAG + "flip1.pdf", fileName: "signed.pdf" } });
    expect(await closeSale(sub)).toEqual({ ok: true }); // previously: splitExceptionRequired
    const tx = await prisma.salesTransaction.findFirstOrThrow({ where: { submissionId: sub } });
    const li = await lineOf(tx.id);
    expect(li.commissionType).toBe("Percentage");
    expect(li.isExternal).toBe(false);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { transactionId: tx.id } });
    expect((await markInvoicePaid(inv.id, fakePdfFile(), { method: "Bank", reference: TAG + "flip1" })).ok).toBe(true);
    const lines = await ledgerAmounts(tx.id);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((l) => l.amount < 0)).toEqual([]);
    expect(lines.filter((l) => l.type === "Personal" && l.who === closerId).reduce((n, l) => n + l.amount, 0)).toBeCloseTo(800, 2);
  });

  it("a sale dated on/after the new effective date takes the NEW shape (Fixed) and its rates: 1500 - 200 = 1300", async () => {
    const sub = await submit("2098-07-01", 10000, pid);
    const tx = await closeAndPay(sub, "flip2");
    expect((await lineOf(tx)).commissionType).toBe("Fixed");
    expect(await closerNet(tx)).toBeCloseTo(1300, 2);
  });

  it("verified sales keep their line values: editing nothing recomputes them (the 2098-03-10 sale still reads Percentage / 800 after the later sale)", async () => {
    const lines = await prisma.saleLineItem.findMany({ where: { productCode: code, submission: { salesDate: new Date("2098-03-10") } } });
    expect(lines).toHaveLength(1);
    expect(lines[0].commissionType).toBe("Percentage");
  });
});

describe("legacy rate snapshots: a missing key falls back to the product column, an explicit false is honoured", () => {
  // Snapshots are written DIRECTLY here: updateProduct always writes every key, so it cannot reach this case.
  const mkLegacy = async (suffix: string, snapshot: object) => {
    const code = TAG + suffix;
    const p = await prisma.product.create({
      data: { productCode: code, productName: "Legacy snap", commissionType: "Fixed", closingCommFixed: "500", companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0", isExternal: true, externalCompanyRetainedPct: "5", defaultCompanyId: companyId, effectiveDate: new Date("2097-01-01") },
    });
    await prisma.commissionStructureVersion.create({ data: { productCode: code, productId: p.id, effectiveDate: new Date("2097-01-01"), rateSnapshot: snapshot as never } });
    return (await resolveSaleLines([{ productId: p.id, lineSaleAmount: 1000, comCodeIds: [] }], "2097-03-01")).lineData[0];
  };

  it("a snapshot with NO isExternal and NO commissionType key: the line carries the product's values, not undefined", async () => {
    const line = await mkLegacy("SNAP1", { closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3" });
    expect(line.isExternal).toBe(true);
    expect(line.commissionType).toBe("Fixed");
  });

  it("an explicit isExternal:false in the snapshot is honoured over the product's true (not swallowed by the fallback)", async () => {
    const line = await mkLegacy("SNAP2", { commissionType: "Percentage", closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3", isExternal: false });
    expect(line.isExternal).toBe(false);
    expect(line.commissionType).toBe("Percentage");
  });
});
