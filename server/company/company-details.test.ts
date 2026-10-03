import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, prismaMock, auditTxMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { company: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() } } as Record<string, unknown> & { company: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> } },
  auditTxMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
prismaMock.$transaction = vi.fn(async (fn: (db: unknown) => unknown) => fn(prismaMock));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), auditTx: auditTxMock }));
vi.mock("@/lib/storage", () => ({ putObject: vi.fn(), deleteObject: vi.fn() }));

import { updateCompanyDetails } from "@/server/company/actions";

const existing = {
  id: "c1", legalName: "Example Co Pte Ltd", address: null, uen: null, paynowUen: null, gstRegNo: null, contactEmail: null, phone: null, website: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", role: "Admin" } });
  prismaMock.company.findUnique.mockResolvedValue(existing);
  prismaMock.company.update.mockResolvedValue({});
});

describe("updateCompanyDetails", () => {
  it("Accounts (not full Admin) is refused and nothing is read or written (1 call examined)", async () => {
    authMock.mockResolvedValue({ user: { id: "u2", role: "Accounts" } });
    const r = await updateCompanyDetails("c1", { uen: "000000000A" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.company.update).not.toHaveBeenCalled();
    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
  });

  it("a malformed PayNow UEN is rejected before any write (1 call examined)", async () => {
    const r = await updateCompanyDetails("c1", { uen: "000000000A", paynowUen: "bad!" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("companyDetailsPaynowUenInvalid");
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  it("a malformed GST registration number is rejected before any write (1 call examined)", async () => {
    const r = await updateCompanyDetails("c1", { gstRegNo: "bad!" });
    expect(r.error).toBe("companyDetailsGstRegNoInvalid");
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  it("GST registration number: Admin saves it with a before/after audit of that field (1 update, 1 audit examined)", async () => {
    const r = await updateCompanyDetails("c1", { gstRegNo: "m2-0000000-0" });
    expect(r.ok).toBe(true);
    expect(prismaMock.company.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.company.update.mock.calls[0][0].data.gstRegNo).toBe("M2-0000000-0");
    expect(auditTxMock).toHaveBeenCalledTimes(1);
    const audit = auditTxMock.mock.calls[0][1];
    expect(audit.before.gstRegNo).toBeNull();
    expect(audit.after.gstRegNo).toBe("M2-0000000-0");
  });

  it("Accounts is refused for the GST registration number too, nothing written (1 call examined)", async () => {
    authMock.mockResolvedValue({ user: { id: "u2", role: "Accounts" } });
    const r = await updateCompanyDetails("c1", { gstRegNo: "M2-0000000-0" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  it.each([
    ["both set, different", { uen: "000000000A", paynowUen: "111111111B" }],
    ["only PayNow set", { paynowUen: "111111111B" }],
    ["one set", { uen: "000000000A" }],
    ["neither set", {}],
  ])("%s: updates exactly one company row, only the detail columns, with a before/after audit", async (_label, input) => {
    const r = await updateCompanyDetails("c1", input);
    expect(r.ok).toBe(true);
    expect(prismaMock.company.update).toHaveBeenCalledTimes(1);
    const arg = prismaMock.company.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "c1" });
    expect(Object.keys(arg.data).sort()).toEqual(
      ["address", "contactEmail", "gstRegNo", "legalName", "paynowUen", "phone", "uen", "website"],
    );
    expect(auditTxMock).toHaveBeenCalledTimes(1);
    const audit = auditTxMock.mock.calls[0][1];
    expect(audit.action).toBe("company_details.updated");
    expect(audit.before.uen).toBeNull();
    expect(audit.after.uen).toBe((input as { uen?: string }).uen ?? null);
    expect(audit.after.paynowUen).toBe((input as { paynowUen?: string }).paynowUen ?? null);
    expect(audit.before.paynowUen).toBeNull();
  });

  it("unknown company id is not-found and writes nothing", async () => {
    prismaMock.company.findUnique.mockResolvedValue(null);
    const r = await updateCompanyDetails("nope", { uen: "000000000A" });
    expect(r).toEqual({ ok: false, error: "notFound" });
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });
});
