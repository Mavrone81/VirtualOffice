// A-17 — quotations are their own record: server-priced, immutable once
// Issued, no approval/signature, owner-or-admin void with a required reason.
// Real throwaway Postgres (needs DATABASE_URL); fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
// MD B2: createQuotation/voidQuotation now refuse outright when the flag is
// off (a separate, dedicated test covers that refusal) — this file tests the
// feature's own real behaviour, which only exists with the flag on.
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), env: { ...(await orig<typeof import("@/lib/env")>()).env, A17_CLOSED_DEAL_FLOW: true } }));

import { prisma } from "@/lib/db";
import { createQuotation, voidQuotation } from "./actions";

const TAG = "A17QUO-";
// user.id lands in a @db.Uuid column (Quotation.createdById), so session
// fixtures need real UUIDs, not readable tags (bit us the same way in A-0).
const CLOSER_USER = "22222222-2222-2222-2222-222222222222";
const OTHER_USER = "33333333-3333-3333-3333-333333333333";
const NO_PROFILE_USER = "44444444-4444-4444-4444-444444444444";
const ADMIN = { user: { associateId: null, id: "11111111-1111-1111-1111-111111111111", role: "Admin" } };
let companyId = "", productId = "", closerId = "", otherId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  productId = (await prisma.product.create({
    data: {
      productCode: TAG + "P1", productName: "Quotation Test", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"),
    },
    select: { id: true },
  })).id;
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
  await prisma.quotation.deleteMany({ where: { associateId: { in: [closerId, otherId] } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.associate.deleteMany({ where: { id: { in: [closerId, otherId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("createQuotation", () => {
  it("server-prices the lines, assigns a QUO- code, and requires an associate profile", async () => {
    who.session = { user: { associateId: null, id: NO_PROFILE_USER, role: "Admin" } };
    const noProfile = await createQuotation({ clientName: "X", quoteDate: "2099-01-01", lines: [{ productId, lineSaleAmount: 100, comCodeIds: [] }] });
    expect(noProfile.ok).toBe(false);

    who.session = { user: { associateId: closerId, id: CLOSER_USER } };
    const r = await createQuotation({ clientName: "Jane Tan", quoteDate: "2099-01-01", lines: [{ productId, lineSaleAmount: 1000, comCodeIds: [] }] });
    expect(r.ok).toBe(true);
    expect(r.quotationCode).toMatch(/^QUO-\d{4}$/);

    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: r.id } });
    expect(q.total.toFixed(2)).toBe("1000.00");
    expect(q.status).toBe("Issued");
    expect((q.lines as unknown as { productCode: string }[])[0].productCode).toBe(TAG + "P1");
  });
});

describe("voidQuotation", () => {
  it("owner or admin can void an Issued quotation with a reason; a different associate cannot", async () => {
    who.session = { user: { associateId: closerId, id: CLOSER_USER } };
    const r = await createQuotation({ clientName: "Ah Beng", quoteDate: "2099-01-01", lines: [{ productId, lineSaleAmount: 500, comCodeIds: [] }] });
    expect(r.ok).toBe(true);

    who.session = { user: { associateId: otherId, id: OTHER_USER, role: "SalesAssociate" } };
    expect(await voidQuotation(r.id!, "not mine")).toEqual({ ok: false, error: "forbidden" });

    who.session = { user: { associateId: closerId, id: CLOSER_USER, role: "SalesAssociate" } };
    expect(await voidQuotation(r.id!, "")).toEqual({ ok: false, error: "reasonRequired" });
    expect((await voidQuotation(r.id!, "client changed their mind")).ok).toBe(true);

    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: r.id } });
    expect(q.status).toBe("Void");
    expect(q.voidReason).toBe("client changed their mind");

    // Voiding an already-Void quotation is refused, not a silent no-op.
    expect(await voidQuotation(r.id!, "again")).toEqual({ ok: false, error: "alreadyProcessed" });
  });

  it("admin can void anyone's quotation", async () => {
    who.session = { user: { associateId: closerId, id: CLOSER_USER } };
    const r = await createQuotation({ clientName: "Mary Lim", quoteDate: "2099-01-01", lines: [{ productId, lineSaleAmount: 200, comCodeIds: [] }] });

    who.session = ADMIN;
    expect((await voidQuotation(r.id!, "admin correction")).ok).toBe(true);
  });
});
