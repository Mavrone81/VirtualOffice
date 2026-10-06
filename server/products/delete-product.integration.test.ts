// Product hard-delete: real Postgres, real auditTx, real Serializable transaction.
//
// 🔴 WHY THESE ARE INTEGRATION TESTS AND NOT UNIT TESTS WITH A MOCKED PRISMA:
// the thing under test is a set of row counts and a cascade, and the one condition
// that matters most — SaleLineItem.upgradeParentProductId — has NO foreign key
// behind it. A mocked client would happily return whatever count the test told it
// to, which proves the branch is wired and nothing about whether the guard holds
// against real rows. Every test below creates its own blocking rows.
//
// 🔴 EVERY ASSERTION COUNTS ROWS ON BOTH SIDES OF THE CALL. The live database has
// zero products and zero sales, so "the product was not deleted" passes trivially
// against a product that was never created. Each test therefore asserts the
// product EXISTS (exactly 1 row) before calling delete, and asserts the blocking
// row it planted exists too — otherwise a guard that had been removed entirely
// would still show green.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
// Identity translator: assertions below check the message KEY the action chose,
// not English prose, so a copy edit cannot turn a wrong-condition bug green.
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { deleteProduct } from "./actions";

const TAG = "PRODDEL-";
const ADMIN_ID = "6f1b9c54-0000-4000-8000-00000000d001";
const ADMIN = { user: { id: ADMIN_ID, associateId: null, role: "Admin" } };

let companyId = "";
let closerId = "";
let seq = 0;

/** A product with two com codes and one commission version — the rows that are
 *  supposed to go with it when a delete is allowed. */
async function makeProduct(): Promise<{ id: string; code: string }> {
  const code = `${TAG}P${++seq}`;
  const product = await prisma.product.create({
    data: {
      productCode: code,
      productName: "Fixture product",
      commissionType: "Percentage",
      closingCommPct: "10",
      companyCutPct: "2",
      smOverridePct: "5",
      sdOverridePct: "3",
      defaultCompanyId: companyId,
      effectiveDate: new Date("2099-01-01"),
      comCodes: {
        create: [
          { comCode: `${code}-A`, label: "Add-on A", valueType: "Percentage", value: "1" },
          { comCode: `${code}-B`, label: "Add-on B", valueType: "Absolute", value: "25" },
        ],
      },
      versions: {
        create: [{ productCode: code, effectiveDate: new Date("2099-01-01"), rateSnapshot: { closingCommPct: "10" } }],
      },
    },
    select: { id: true },
  });
  return { id: product.id, code };
}

/** One submission + one line item. `over` lets a test aim the line item at
 *  whichever of the four links it is exercising. */
async function makeLineItem(over: {
  productCode: string;
  structureVersionId?: string;
  upgradeParentProductId?: string;
}): Promise<string> {
  const submission = await prisma.salesSubmission.create({
    data: {
      salesDate: new Date("2099-02-01"),
      clientName: `${TAG}client`,
      saleAmount: "1000",
      paymentPlan: "FullPayment",
      closingAssociateId: closerId,
    },
    select: { id: true },
  });
  const line = await prisma.saleLineItem.create({
    data: {
      submissionId: submission.id,
      companyId,
      productCode: over.productCode,
      productName: "Fixture product",
      commissionType: "Percentage",
      lineSaleAmount: "1000",
      structureVersionId: over.structureVersionId ?? null,
      upgradeParentProductId: over.upgradeParentProductId ?? null,
    },
    select: { id: true },
  });
  return line.id;
}

/** Everything a test needs to assert on both sides of a call, in one round trip. */
async function snapshot(productId: string, productCode: string) {
  const [product, comCodes, versions] = await Promise.all([
    prisma.product.count({ where: { id: productId } }),
    prisma.comcode.count({ where: { productId } }),
    prisma.commissionStructureVersion.count({ where: { productId } }),
  ]);
  const [lineItemsByCode, lineItemsByUpgrade, childProducts] = await Promise.all([
    prisma.saleLineItem.count({ where: { productCode } }),
    prisma.saleLineItem.count({ where: { upgradeParentProductId: productId } }),
    prisma.product.count({ where: { parentProductId: productId } }),
  ]);
  return { product, comCodes, versions, lineItemsByCode, lineItemsByUpgrade, childProducts };
}

/** Remove every row this file owns, in FK-safe order. Idempotent, and run at BOTH
 *  ends: a run that dies mid-way (a crashed afterAll, a killed process) would
 *  otherwise leave its fixtures behind and the next run would fail in beforeAll on
 *  a unique constraint instead of on anything real. */
async function purge(): Promise<void> {
  const subs = await prisma.salesSubmission.findMany({
    where: { clientName: `${TAG}client` },
    select: { id: true },
  });
  const subIds = subs.map((x) => x.id);
  if (subIds.length) {
    await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
    await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  }
  // Any line item this file created but aimed at a TAG code with no submission match.
  await prisma.saleLineItem.deleteMany({ where: { productCode: { startsWith: TAG } } });
  // Order matters: com codes and versions hold FKs into products, and a child
  // product holds one into its upgrade parent, so dependants come off first and
  // the ProductUpgrade children come off before their parents.
  await prisma.comcode.deleteMany({ where: { product: { productCode: { startsWith: TAG } } } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG }, parentProductId: { not: null } } });
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: { associateCode: `${TAG}CL` } });
  await prisma.company.deleteMany({ where: { invoicePrefix: `${TAG}INV` } });
  // 🔴 audit_log is NOT cleaned up, and must not be: the table carries a
  // database trigger that refuses DELETE outright ("audit_log is append-only").
  // Nothing here needs it — the audit assertion below matches on the deleted
  // product's own id, which is freshly generated per run, so rows left by an
  // earlier run can never satisfy it.
}

beforeAll(async () => {
  await purge();
  companyId = (
    await prisma.company.create({
      data: { name: `${TAG}Co`, invoicePrefix: `${TAG}INV`, active: true },
      select: { id: true },
    })
  ).id;
  closerId = (
    await prisma.associate.create({
      data: {
        associateCode: `${TAG}CL`,
        fullName: "Fixture closer",
        designation: "SalesAssociate",
        approvalStatus: "Approved",
        associateStatus: "Active",
      },
      select: { id: true },
    })
  ).id;
});

afterAll(purge);

afterEach(() => {
  who.session = null;
});

describe("deleteProduct — refuses anything with history (owner's ruling: sold products are deactivated, not deleted)", () => {
  it("(a) refuses when a line item points at one of the product's commission versions, and the product survives", async () => {
    who.session = ADMIN;
    const { id, code } = await makeProduct();
    const version = await prisma.commissionStructureVersion.findFirstOrThrow({ where: { productId: id }, select: { id: true } });
    await makeLineItem({ productCode: `${TAG}OTHER-A`, structureVersionId: version.id });

    const before = await snapshot(id, code);
    // The fixture itself is asserted, not assumed: 1 product, 2 com codes, 1
    // version, and the blocking line item reachable through the version relation.
    expect(before.product).toBe(1);
    expect(before.comCodes).toBe(2);
    expect(before.versions).toBe(1);
    expect(await prisma.saleLineItem.count({ where: { structureVersion: { productId: id } } })).toBe(1);
    // Deliberately NOT blocked by (d): the line item carries a different code.
    expect(before.lineItemsByCode).toBe(0);

    const r = await deleteProduct(id);
    expect(r).toEqual({ ok: false, error: "productDeleteBlockedBySale" });

    const after = await snapshot(id, code);
    expect(after).toEqual(before);
    // 🔴 Counting rows is not enough here. sale_line_items.structure_version_id is
    // ON DELETE SET NULL, so deleting the version would not remove the line item —
    // it would silently blank the link between the sale and the rates it was priced
    // with, leaving every row count unchanged. Assert the link itself survives.
    expect(await prisma.saleLineItem.count({ where: { structureVersionId: version.id } })).toBe(1);
    expect(await prisma.commissionStructureVersion.count({ where: { id: version.id } })).toBe(1);
  });

  it("(b) refuses when a line item's upgradeParentProductId names the product — the link with NO foreign key", async () => {
    who.session = ADMIN;
    const { id, code } = await makeProduct();
    // 🔴 This is the condition the database cannot enforce. upgrade_parent_product_id
    // has no FK, so Postgres would let the product be deleted and leave this uuid
    // pointing at nothing. The line item carries an unrelated productCode so that
    // (d) cannot be what refuses, and no structureVersionId so (a) cannot be either
    // — this test fails unless condition (b) itself is doing the work.
    await makeLineItem({ productCode: `${TAG}OTHER-B`, upgradeParentProductId: id });

    const before = await snapshot(id, code);
    expect(before.product).toBe(1);
    expect(before.lineItemsByUpgrade).toBe(1);
    expect(before.lineItemsByCode).toBe(0);
    expect(await prisma.saleLineItem.count({ where: { structureVersion: { productId: id } } })).toBe(0);

    const r = await deleteProduct(id);
    expect(r).toEqual({ ok: false, error: "productDeleteBlockedByUpgradeSale" });

    const after = await snapshot(id, code);
    expect(after).toEqual(before);
    // Stated positively: the dangle never happened.
    expect(after.product).toBe(1);
    expect(after.lineItemsByUpgrade).toBe(1);
  });

  it("(c) refuses when another product is an upgrade from it, and the product survives", async () => {
    who.session = ADMIN;
    const parent = await makeProduct();
    const child = await makeProduct();
    await prisma.product.update({ where: { id: child.id }, data: { parentProductId: parent.id } });

    const before = await snapshot(parent.id, parent.code);
    expect(before.product).toBe(1);
    expect(before.childProducts).toBe(1);
    expect(before.lineItemsByCode).toBe(0);

    const r = await deleteProduct(parent.id);
    expect(r).toEqual({ ok: false, error: "productDeleteBlockedByUpgradeChild" });

    const after = await snapshot(parent.id, parent.code);
    expect(after).toEqual(before);
    // 🔴 products_parent_product_id_fkey is ON DELETE SET NULL, NOT RESTRICT, so the
    // database would NOT have refused this delete — it would have kept the child row
    // and quietly blanked its parentProductId, destroying the upgrade relationship
    // with no error anywhere. A row count alone cannot see that, so assert the link.
    const childAfter = await prisma.product.findUniqueOrThrow({ where: { id: child.id }, select: { parentProductId: true } });
    expect(childAfter.parentProductId).toBe(parent.id);
  });

  it("(d) refuses on a bare productCode match even with no version link — the backstop for a NULL structureVersionId", async () => {
    who.session = ADMIN;
    const { id, code } = await makeProduct();
    // structureVersionId is NULLABLE, so this line item is invisible to (a).
    // A productCode match is the only remaining link, which is exactly why (d)
    // is not redundant.
    await makeLineItem({ productCode: code });

    const before = await snapshot(id, code);
    expect(before.product).toBe(1);
    expect(before.lineItemsByCode).toBe(1);
    expect(await prisma.saleLineItem.count({ where: { structureVersion: { productId: id } } })).toBe(0);
    expect(before.lineItemsByUpgrade).toBe(0);
    expect(before.childProducts).toBe(0);

    const r = await deleteProduct(id);
    expect(r).toEqual({ ok: false, error: "productDeleteBlockedByProductCode" });

    const after = await snapshot(id, code);
    expect(after).toEqual(before);
  });

  it("refuses by RETURNING the error rather than throwing it", async () => {
    who.session = ADMIN;
    const { id, code } = await makeProduct();
    await makeLineItem({ productCode: code });

    expect((await snapshot(id, code)).product).toBe(1);
    // The assertion is the shape of the outcome: a resolved object. If the action
    // threw, this expression would reject and the test would fail here rather
    // than on the value — so both halves of "returned, not thrown" are covered.
    const settled = await Promise.allSettled([deleteProduct(id)]);
    expect(settled[0].status).toBe("fulfilled");
    expect(settled[0]).toMatchObject({ value: { ok: false, error: "productDeleteBlockedByProductCode" } });
    expect((await snapshot(id, code)).product).toBe(1);
  });
});

describe("deleteProduct — deletes a product with no history at all", () => {
  it("deletes the product and takes its com codes and unreferenced commission versions with it", async () => {
    who.session = ADMIN;
    const { id, code } = await makeProduct();

    const before = await snapshot(id, code);
    // All four refusal conditions are genuinely clear, asserted rather than assumed.
    expect(before).toEqual({ product: 1, comCodes: 2, versions: 1, lineItemsByCode: 0, lineItemsByUpgrade: 0, childProducts: 0 });

    const r = await deleteProduct(id);
    expect(r).toEqual({ ok: true });

    const after = await snapshot(id, code);
    expect(after).toEqual({ product: 0, comCodes: 0, versions: 0, lineItemsByCode: 0, lineItemsByUpgrade: 0, childProducts: 0 });
    // 🔴 `versions: 0` above counts by productId, and that count cannot tell a
    // DELETED version from an ORPHANED one: the FK is ON DELETE SET NULL, so simply
    // deleting the product would blank productId and satisfy the count while the row
    // survived. Counting by productCode is what actually proves the row is gone.
    expect(await prisma.commissionStructureVersion.count({ where: { productCode: code } })).toBe(0);

    // The deletion is recorded the way the other product actions record theirs.
    const audits = await prisma.auditLog.findMany({ where: { action: "product.deleted", entityId: id } });
    expect(audits).toHaveLength(1);
    expect(audits[0].beforeJson).toMatchObject({ productCode: code });
  });

  it("leaves a sibling product that shares the product code, and its own versions, untouched", async () => {
    who.session = ADMIN;
    // @@unique([productCode, effectiveDate]) lets one code have many product rows.
    // The version cleanup is scoped by productId for this reason; scoping it by
    // productCode would reach into the sibling's history.
    const code = `${TAG}SHARED`;
    const mk = (eff: string) =>
      prisma.product.create({
        data: {
          productCode: code, productName: "Shared code", commissionType: "Percentage",
          closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
          defaultCompanyId: companyId, effectiveDate: new Date(eff),
          versions: { create: [{ productCode: code, effectiveDate: new Date(eff), rateSnapshot: { v: eff } }] },
        },
        select: { id: true },
      });
    const older = await mk("2099-03-01");
    const newer = await mk("2099-04-01");

    expect(await prisma.commissionStructureVersion.count({ where: { productCode: code } })).toBe(2);

    const r = await deleteProduct(newer.id);
    expect(r).toEqual({ ok: true });

    expect(await prisma.product.count({ where: { id: newer.id } })).toBe(0);
    expect(await prisma.product.count({ where: { id: older.id } })).toBe(1);
    // Exactly one version removed: the deleted product's own.
    expect(await prisma.commissionStructureVersion.count({ where: { productId: older.id } })).toBe(1);
    expect(await prisma.commissionStructureVersion.count({ where: { productCode: code } })).toBe(1);
  });
});

describe("deleteProduct — authority", () => {
  it("refuses a non-admin session and leaves the product in place", async () => {
    who.session = { user: { id: ADMIN_ID, associateId: null, role: "SalesAssociate" } };
    const { id, code } = await makeProduct();

    expect((await snapshot(id, code)).product).toBe(1);
    const r = await deleteProduct(id);
    expect(r).toEqual({ ok: false, error: "forbidden" });
    const after = await snapshot(id, code);
    expect(after.product).toBe(1);
    expect(after.comCodes).toBe(2);
    expect(after.versions).toBe(1);
  });

  it("refuses with no session at all", async () => {
    who.session = null;
    const { id, code } = await makeProduct();
    expect((await snapshot(id, code)).product).toBe(1);
    expect(await deleteProduct(id)).toEqual({ ok: false, error: "forbidden" });
    expect((await snapshot(id, code)).product).toBe(1);
  });

  it("returns notFound for an id that does not exist, without throwing", async () => {
    who.session = ADMIN;
    const missing = "6f1b9c54-0000-4000-8000-0000000dead0";
    expect(await prisma.product.count({ where: { id: missing } })).toBe(0);
    expect(await deleteProduct(missing)).toEqual({ ok: false, error: "notFound" });
  });
});
