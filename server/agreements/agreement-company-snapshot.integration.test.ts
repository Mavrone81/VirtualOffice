// The company block is frozen into the agreement's own record (signedTerms.company)
// at the moment the applicant signs, and every later render of that agreement
// reads it from there, never from the Company row. Real throwaway Postgres.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { AGREEMENT_COMPANY_PREFIX, AGREEMENT_PARTY_DEFAULTS as P, LEGACY_DOCUMENT_DEFAULTS as L, agreementContactLine, snapshotAgreementCompany } from "@/lib/company-identity";

const TAG = "A17CO-";
let companyId = "", ashesProductId = "", closerId = "";
let submitSale: (input: unknown) => Promise<{ id?: string }>;
let signAshesAgreement: (submissionId: string, dataUrl: string) => Promise<{ ok: boolean; error?: string }>;
let renderAshesAgreementPdf: (id: string) => Promise<{ buffer: Buffer } | null>;

const FAKE_PNG_DATA_URL = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;

// Obviously fake values.
const V1 = { legalName: "Example Holdings Pte Ltd", address: "1 Example Road Singapore 000001", uen: "000000001A", gstRegNo: "M0-0000001-0", contactEmail: "hello@example.invalid", phone: "0000 0001", website: "www.example.invalid" };
const V2 = { legalName: "Changed Name Pte Ltd", address: "2 Changed Street Singapore 000002", uen: "000000002B", gstRegNo: "M0-0000002-0", contactEmail: "changed@example.invalid", phone: "0000 0002", website: "www.changed.invalid" };
const EMPTY = { legalName: null, address: null, uen: null, gstRegNo: null, contactEmail: null, phone: null, website: null };
const FIELDS = ["legalName", "address", "uen", "gstRegNo", "contactEmail", "phone", "website"] as const;

let eppId = "";
let eppCreated = false;
let eppOriginal: Record<string, string | null> | null = null;

const setEpp = (v: Record<string, string | null>) => prisma.company.update({ where: { id: eppId }, data: v });

function toText(buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "agr-"));
  try {
    const f = join(dir, "o.pdf");
    writeFileSync(f, buffer);
    return execFileSync("pdftotext", [f, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function signNewSale(label: string) {
  who.session = { user: { associateId: closerId, id: closerId } };
  const r = await submitSale({ salesDate: "2026-08-01", clientName: label, paymentPlan: "Full Payment", lines: [{ productId: ashesProductId, lineSaleAmount: 1000, comCodeIds: [] }] });
  const sub = await prisma.salesSubmission.findUniqueOrThrow({ where: { id: r.id! }, select: { ashesAgreement: { select: { id: true } } } });
  expect(await signAshesAgreement(r.id!, FAKE_PNG_DATA_URL)).toEqual({ ok: true });
  return prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: sub.ashesAgreement!.id } });
}

beforeAll(async () => {
  process.env.A17_CLOSED_DEAL_FLOW = "true";
  vi.resetModules();
  ({ submitSale } = (await import("@/server/sales/actions")) as never);
  ({ signAshesAgreement } = (await import("./actions")) as never);
  ({ renderAshesAgreementPdf } = (await import("@/lib/pdf/ashes-agreement")) as never);

  companyId = (await prisma.company.create({ data: { name: TAG + "Co", invoicePrefix: TAG + "INV", active: true }, select: { id: true } })).id;
  const existing = await prisma.company.findUnique({ where: { invoicePrefix: AGREEMENT_COMPANY_PREFIX } });
  if (existing) {
    eppId = existing.id;
    eppOriginal = Object.fromEntries(FIELDS.map((k) => [k, existing[k]]));
  } else {
    eppId = (await prisma.company.create({ data: { name: TAG + "EPP", invoicePrefix: AGREEMENT_COMPANY_PREFIX, active: true }, select: { id: true } })).id;
    eppCreated = true;
  }
  ashesProductId = (await prisma.product.create({
    data: {
      productCode: TAG + "ASH", productName: "Columbarium Niche", commissionType: "Percentage" as never,
      closingCommPct: "10", companyCutPct: "2", smOverridePct: "5", sdOverridePct: "3",
      defaultCompanyId: companyId, effectiveDate: new Date("2099-01-01"), requiresAshesAgreement: true,
    },
    select: { id: true },
  })).id;
  closerId = (await prisma.associate.create({
    data: { associateCode: TAG + "CL", fullName: "Closer", designation: "SalesAssociate" as never, approvalStatus: "Approved" as never, associateStatus: "Active" as never },
    select: { id: true },
  })).id;
});

afterAll(async () => {
  delete process.env.A17_CLOSED_DEAL_FLOW;
  const subs = await prisma.salesSubmission.findMany({ where: { closingAssociateId: closerId }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  await prisma.submissionDocument.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.petsAshesAgreement.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.saleLineItem.deleteMany({ where: { submissionId: { in: subIds } } });
  await prisma.salesSubmission.deleteMany({ where: { id: { in: subIds } } });
  await prisma.product.deleteMany({ where: { id: ashesProductId } });
  await prisma.associate.deleteMany({ where: { id: closerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  if (eppCreated) await prisma.company.deleteMany({ where: { id: eppId } });
  else if (eppOriginal) await setEpp(eppOriginal);
});

afterEach(() => {
  who.session = null;
});

describe("signAshesAgreement freezes the company block at signing (3 agreements signed, 2 re-renders)", () => {
  it("company filled, then edited AFTER signing: the record holds the values at signing and the re-render still prints them", async () => {
    await setEpp(V1);
    const signed = await signNewSale("Company Snapshot Client One");
    const terms = signed.signedTerms as Record<string, unknown>;

    expect(terms.company).toEqual(snapshotAgreementCompany(V1));
    expect(terms.company).toMatchObject({ v: 1, name: V1.legalName, uen: V1.uen, gstRegNo: V1.gstRegNo, address: V1.address, phone: V1.phone, email: V1.contactEmail, website: V1.website });
    expect(Object.keys(terms).sort()).toEqual(["company", "deposit", "installmentCount", "paymentPlan", "products", "saleAmount"]);

    const storedText = toText((await getObject(signed.agreementPdfKey!))!);
    expect(storedText).toContain(V1.address);
    expect(storedText).toContain(V1.contactEmail);

    await setEpp(V2); // the owner edits /admin/company afterwards
    const rerender = toText((await renderAshesAgreementPdf(signed.id))!.buffer);
    expect(rerender).toEqual(storedText);
    expect(rerender).not.toContain(V2.address);
    expect(rerender).not.toContain(V2.contactEmail);

    // a second agreement signed after the edit gets the new values; the first is untouched
    const second = await signNewSale("Company Snapshot Client Two");
    expect((second.signedTerms as { company: unknown }).company).toEqual(snapshotAgreementCompany(V2));
    expect(toText((await getObject(second.agreementPdfKey!))!)).toContain(V2.address);
    const firstAgain = await prisma.petsAshesAgreement.findUniqueOrThrow({ where: { id: signed.id } });
    expect((firstAgain.signedTerms as { company: unknown }).company).toEqual(snapshotAgreementCompany(V1));
    expect(createHash("sha256").update((await getObject(firstAgain.agreementPdfKey!))!).digest("hex")).toBe(firstAgain.signedPdfSha256);
  });

  it("company never filled: the record freezes the constants, and filling it later does not change that agreement", async () => {
    await setEpp(EMPTY);
    const signed = await signNewSale("Company Snapshot Client Three");
    const snap = (signed.signedTerms as { company: Record<string, string | null> }).company;
    expect(snap).toEqual({ v: 1, name: P.name, uen: P.uen, gstRegNo: null, address: L.address.replace(",", ""), phone: L.phone, email: L.email, website: L.website });

    const storedText = toText((await getObject(signed.agreementPdfKey!))!);
    expect(storedText).toContain(agreementContactLine().replace(/\s+/g, " "));

    await setEpp(V1);
    expect(toText((await renderAshesAgreementPdf(signed.id))!.buffer)).toEqual(storedText);
  });
});
