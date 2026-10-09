// Audit reliability (reviews/audit-reliability.md) — Tier A payee, security and
// commission-input actions: the change and its record commit together; a
// failed audit leaves everything as it was ("auditUnavailable"). Payee details
// are recorded MASKED only. Real Postgres + real auditTx; audit failures via the
// local-only trigger (lib/test-audit-fault.ts). Fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { encryptPII, decryptPiiRaw } from "@/lib/crypto";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";
import { updateAssociate, updateAssociateUplines } from "./associates/actions";
import { resetAssociatePassword } from "./account/actions";
import { updateProduct } from "./products/actions";

const TAG = "AUDTSEC-";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN = { user: { associateId: null, id: ADMIN_ID, role: "Admin" } };
let assocId = "", uplineId = "", userId = "", productId = "";

beforeAll(async () => {
  await installAuditFault();
  uplineId = (await prisma.associate.create({ data: { associateCode: TAG + "U1", fullName: TAG + "Upline", designation: "SalesDirector", approvalStatus: "Approved", associateStatus: "Active" }, select: { id: true } })).id;
  assocId = (await prisma.associate.create({
    data: {
      associateCode: TAG + "A1", fullName: TAG + "Payee", designation: "SalesAssociate", approvalStatus: "Approved", associateStatus: "Active",
      paymentMethod: "BankTransfer", bankName: "Fake Bank", bankAccountNumber: encryptPII("000-000000-1111"),
    },
    select: { id: true },
  })).id;
  userId = (await prisma.user.create({ data: { email: TAG.toLowerCase() + "a1@example.com", passwordHash: "x", role: "SalesAssociate", associateId: assocId }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: { productCode: TAG + "P1", productName: "Fake product", commissionType: "Percentage", closingCommPct: "10", companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0", isExternal: false, activeStatus: "Active", effectiveDate: new Date("2196-01-01") },
    select: { id: true },
  })).id;
  who.session = ADMIN;
});
afterEach(clearAuditFaults);
afterAll(async () => {
  await prisma.commissionStructureVersion.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.associate.deleteMany({ where: { id: { in: [assocId, uplineId] } } });
  await removeAuditFault();
});

const edit = (bankAccountNumber: string) => updateAssociate(assocId, {
  fullName: TAG + "Payee", designation: "SalesAssociate", paymentMethod: "Bank Transfer", bankName: "Fake Bank", bankAccountNumber,
});

describe("payee details (the payout-redirection path)", () => {
  it("a bank-account change is recorded masked (last 4 only), before and after, in the same transaction", async () => {
    expect(await edit("999-999999-2222")).toEqual({ ok: true });
    const a = await prisma.auditLog.findFirstOrThrow({ where: { action: "associate.updated", entityId: assocId }, orderBy: { createdAt: "desc" } });
    const json = JSON.stringify([a.beforeJson, a.afterJson]);
    expect(json).toContain("1111"); // masked before
    expect(json).toContain("2222"); // masked after
    expect(json).not.toContain("000-000000"); // never the full numbers
    expect(json).not.toContain("999-999999");
    expect(a.actorUserId).toBe(ADMIN_ID);
  });

  it("with the audit failing, the account is unchanged", async () => {
    await failAuditsFor(assocId);
    expect(await edit("555-555555-3333")).toEqual({ ok: false, error: "auditUnavailable" });
    const row = await prisma.associate.findUniqueOrThrow({ where: { id: assocId } });
    expect(decryptPiiRaw(row.bankAccountNumber!)).toBe("999-999999-2222");
  });
});

describe("security + commission inputs", () => {
  it("admin password reset: nothing changes and no temp password is shown", async () => {
    await failAuditsFor(userId);
    expect(await resetAssociatePassword(assocId)).toEqual({ ok: false, error: "auditUnavailable" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe("x");
  });

  it("upline change: stays as it was", async () => {
    await failAuditsFor("associate.uplines.updated");
    expect(await updateAssociateUplines(assocId, TAG + "U1", null)).toEqual({ ok: false, error: "auditUnavailable" });
    expect((await prisma.associate.findUniqueOrThrow({ where: { id: assocId } })).directUplineId).toBeNull();
  });

  it("rates change: no new structure version, product rates unchanged", async () => {
    const before = await prisma.commissionStructureVersion.count({ where: { productId } });
    await failAuditsFor(productId);
    const r = await updateProduct(productId, {
      productName: "Fake product", commissionType: "Percentage", closingCommPct: "25", companyCutPct: "0",
      smOverridePct: "0", sdOverridePct: "0", isExternal: false, effectiveDate: "2196-06-01",
      listedPrice: "1.00",
    });
    expect(r).toEqual({ ok: false, error: "auditUnavailable" });
    expect(await prisma.commissionStructureVersion.count({ where: { productId } })).toBe(before);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).closingCommPct?.toString()).toBe("10");
  });
});

describe("designation drives the login role (Bug 001, 28 Sep)", () => {
  const setDesignation = (designation: "SalesAssociate" | "SalesManager") => updateAssociate(assocId, {
    fullName: TAG + "Payee", designation, paymentMethod: "Bank Transfer", bankName: "Fake Bank",
  });

  it("promoting to Sales Manager moves the login role with it, recorded in the same audit row", async () => {
    expect(await setDesignation("SalesManager")).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } })).role).toBe("SalesManager");
    const a = await prisma.auditLog.findFirstOrThrow({ where: { action: "associate.updated", entityId: assocId }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(a.beforeJson)).toContain("SalesAssociate");
    expect(JSON.stringify(a.afterJson)).toContain("\"role\":\"SalesManager\"");
    // …and back, so the role never outlives the designation that granted it.
    expect(await setDesignation("SalesAssociate")).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } })).role).toBe("SalesAssociate");
  });

  it("never touches an office role (Admin/Accounts are assigned, not derived)", async () => {
    await prisma.user.update({ where: { id: userId }, data: { role: "Accounts" } });
    try {
      expect(await setDesignation("SalesManager")).toEqual({ ok: true });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } })).role).toBe("Accounts");
    } finally {
      await setDesignation("SalesAssociate");
      await prisma.user.update({ where: { id: userId }, data: { role: "SalesAssociate" } });
    }
  });
});
