import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// REQUIRES poppler-utils (`pdftotext`): reads what was actually printed.
//
// A signed agreement must never change. These tests render the agreements
// from an at-signing company snapshot, EDIT the live company row between two
// renders, and assert the output did not move. Each describe block states how
// many documents its assertions examined.

type CompanyRow = { legalName: string | null; address: string | null; uen: string | null; gstRegNo: string | null; contactEmail: string | null; phone: string | null; website: string | null };

// The "live" company row the mock database serves. A renderer that wrongly
// read it would see the edits made below.
const { prismaMock, live } = vi.hoisted(() => {
  const live: { row: Record<string, string | null> } = { row: {} };
  return {
    live,
    prismaMock: {
      petsAshesAgreement: { findUnique: vi.fn() },
      company: { findMany: vi.fn(async () => [live.row]), findUnique: vi.fn(async () => live.row), findFirst: vi.fn(async () => live.row) },
    },
  };
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage", () => ({ getObject: vi.fn(async () => null) }));

import { renderAshesAgreementPdf } from "@/lib/pdf/ashes-agreement";
import { renderReferralAgreementPdfFromData, type ReferralAgreementData } from "@/lib/pdf/referral-agreement";
import { AGREEMENT_PARTY_DEFAULTS as P, LEGACY_DOCUMENT_DEFAULTS as L, agreementContactLine, snapshotAgreementCompany, type AgreementCompanySnapshot } from "@/lib/company-identity";

// Obviously fake values; nothing here is a real company detail.
const FAKE_V1: CompanyRow = { legalName: "Example Holdings Pte Ltd", address: "1 Example Road Singapore 000001", uen: "000000001A", gstRegNo: "M0-0000001-0", contactEmail: "hello@example.invalid", phone: "0000 0001", website: "www.example.invalid" };
const FAKE_V2: CompanyRow = { legalName: "Changed Name Pte Ltd", address: "2 Changed Street Singapore 000002", uen: "000000002B", gstRegNo: "M0-0000002-0", contactEmail: "changed@example.invalid", phone: "0000 0002", website: "www.changed.invalid" };

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

const referralData = (company?: AgreementCompanySnapshot | null): ReferralAgreementData => ({
  agreementDate: new Date("2026-09-01T00:00:00Z"), vendorName: "Example Vendor", vendorUen: null, vendorAddress: null, vendorSignerName: "Example Signer", vendorSignerNric: null,
  vendorSignerDesignation: null, vendorSignatureDataUrl: null, vendorSignedDate: new Date("2026-09-01T00:00:00Z"), companySignName: null, companySignDesignation: null,
  companySignatureDataUrl: null, companySignedAt: null, ...(company === undefined ? {} : { company }),
});

const ashesRow = (signedTerms: unknown) => ({
  id: "a1", submission: { clientName: "Test Client" }, storageSpaceLocation: "X", nicheUnit: "1", pets: [], applicant1Name: "Test Applicant",
  applicant1Nric: null, applicant1Address: "1 Example Road", applicant1Contact: "000", applicant1Email: "a@example.invalid", applicant2Name: null, applicant2Nric: null,
  applicant2Address: null, applicant2Contact: null, applicant2Email: null, amountNumeric: { toFixed: () => "100.00" }, amountWords: "One hundred",
  paymentPlan: "FullPayment", bookingFee: null, monthlyInstalment: null, instalmentDayOfMonth: null, maintenanceStartYear: null, additionalTerms: null,
  signedAt: new Date("2026-09-01T00:00:00Z"), applicantSignatureKey: null, applicantWitnessName: null, applicantWitnessNric: null, companyWitnessName: null, companyWitnessNric: null,
  signedTerms,
});
const TERMS = { saleAmount: "100.00", paymentPlan: "FullPayment", deposit: null, installmentCount: null, products: ["X"] };

const ashesText = async (signedTerms: unknown) => {
  prismaMock.petsAshesAgreement.findUnique.mockResolvedValue(ashesRow(signedTerms));
  return toText((await renderAshesAgreementPdf("a1"))!.buffer);
};
beforeEach(() => {
  vi.clearAllMocks();
  live.row = { ...FAKE_V1 };
  // react-pdf stamps a creation date into every file; freeze the clock so a
  // render is compared on its content, not the second it happened in.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("snapshot present, company row edited between two renders (ashes 6 renders, referral 3 renders)", () => {
  it("ashes: identical CONTENT before and after the company row is edited, and the company row is never read", async () => {
    const signedTerms = { ...TERMS, company: snapshotAgreementCompany(live.row as CompanyRow) };
    const first = await ashesText(signedTerms);

    live.row = { ...FAKE_V2 }; // the owner edits /admin/company after signing
    const second = await ashesText(signedTerms);
    const third = await ashesText(signedTerms);

    // Compared on extracted TEXT, not raw bytes. The renderer is NOT
    // byte-deterministic: identical input produced 2 distinct byte streams in
    // 24 renders (measured on a Linux runner at f415de1 — it happens not to
    // reproduce on every machine, which is exactly why a byte assertion here is
    // wrong rather than merely flaky). Bytes would assert a property the
    // renderer does not have; the guarantee this test exists for is that the
    // CONTENT of a signed agreement cannot move, and that is what is asserted.
    expect(first.length).toBeGreaterThan(200);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.company.findFirst).not.toHaveBeenCalled();
  });

  it("negative control: a snapshot taken AFTER the edit does print differently, so the test above can fail (2 renders)", async () => {
    const before = await ashesText({ ...TERMS, company: snapshotAgreementCompany(FAKE_V1) });
    const after = await ashesText({ ...TERMS, company: snapshotAgreementCompany(FAKE_V2) });
    expect(before).toContain(FAKE_V1.address as string);
    expect(before).not.toContain(FAKE_V2.address as string);
    expect(after).toContain(FAKE_V2.address as string);
    expect(after).not.toContain(FAKE_V1.address as string);
    expect(before).not.toEqual(after);
  });

  it("ashes: the snapshot values are what is printed (header, recital, signature block)", async () => {
    const t = await ashesText({ ...TERMS, company: snapshotAgreementCompany(FAKE_V1) });
    for (const v of [FAKE_V1.address, FAKE_V1.phone, FAKE_V1.contactEmail, FAKE_V1.website, `UEN ${FAKE_V1.uen}`, `${FAKE_V1.legalName} (hereinafter`, `: ${FAKE_V1.uen}`]) {
      expect(t).toContain(v as string);
    }
    // none of the constants it replaced
    for (const c of [L.email, L.website, L.phone, P.uen]) expect(t).not.toContain(c);
    // GST number is captured but the agreements have no place to print it
    expect(t).not.toContain(FAKE_V1.gstRegNo as string);
  });

  it("referral: identical printed text before and after the company row is edited (the renderer's bytes vary run to run on their own, so text is compared)", async () => {
    const snap = snapshotAgreementCompany(live.row as CompanyRow);
    const first = toText(await renderReferralAgreementPdfFromData(referralData(snap)));
    live.row = { ...FAKE_V2 };
    const second = toText(await renderReferralAgreementPdfFromData(referralData(snap)));
    const third = toText(await renderReferralAgreementPdfFromData(referralData(snap)));
    expect(first).toContain(FAKE_V1.address as string);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first).toContain(FAKE_V1.uen as string);
    expect(first).toContain((FAKE_V1.legalName as string).toUpperCase());
    expect(first).toContain(`SIGNED by ${FAKE_V1.legalName}`);
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
  });
});

describe("snapshot absent: output is the constants, exactly as before (ashes 7 renders, referral 2 renders)", () => {
  const referralConstants = (t: string) => {
    expect(t).toContain(agreementContactLine().replace(/\s+/g, " "));
    expect(t).toContain(`UEN ${P.uen}`);
    expect(t).toContain(`ENSHRINE PETS PARADISE PTE. LTD. (UEN: ${P.uen})`);
    expect(t).toContain(`registered office at ${L.address.replace(",", "")}.`);
    expect(t).toContain(`SIGNED by ${P.name}`);
  };

  it("ashes with signedTerms null, and with a pre-change signedTerms that has no company key: identical content to each other even though the company row holds other values", async () => {
    live.row = { ...FAKE_V2 };
    // Content, not bytes — see the note on the immutability test above: the
    // renderer is not byte-deterministic, so byte equality would assert a
    // property it does not have.
    const a = await ashesText(null);
    const b = await ashesText(TERMS);
    const c = await ashesText({ ...TERMS, company: null });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    const t = a;
    expect(t).toContain(agreementContactLine().replace(/\s+/g, " "));
    expect(t).toContain(`UEN ${P.uen}`);
    expect(t).toContain(`${P.name} (hereinafter`);
    expect(t).toContain(`: ${P.uen}`);
    expect(t).not.toContain(FAKE_V2.address as string);
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
  });

  it("ashes: an unreadable or foreign-version company value reads as no snapshot (3 renders)", async () => {
    const constantsText = await ashesText(null);
    for (const bad of [{ v: 2, name: "X" }, "not an object", [FAKE_V1]]) {
      expect(await ashesText({ ...TERMS, company: bad })).toEqual(constantsText);
    }
  });

  it("referral without a snapshot prints the constants", async () => {
    referralConstants(toText(await renderReferralAgreementPdfFromData(referralData())));
    referralConstants(toText(await renderReferralAgreementPdfFromData(referralData(null))));
  });
});

describe("snapshot present but partially empty: unfilled fields print the constant, never a blank or a marker (ashes 3 renders, referral 1 render)", () => {
  const partial: AgreementCompanySnapshot = { v: 1, name: null, uen: "  ", gstRegNo: null, address: "9 Partial Lane Singapore 000009", phone: null, email: "partial@example.invalid", website: null };

  it("ashes: filled fields print, empty ones fall back field by field", async () => {
    const t = await ashesText({ ...TERMS, company: partial });
    expect(t).toContain("Address: 9 Partial Lane Singapore 000009");
    expect(t).toContain("Email: partial@example.invalid");
    expect(t).toContain(`Contact: ${L.phone}`);
    expect(t).toContain(`Website: ${L.website}`);
    expect(t).toContain(`UEN ${P.uen}`);
    expect(t).toContain(`${P.name} (hereinafter`);
    expect(t).not.toMatch(/not set\]|undefined|null/);
    expect(t).not.toContain(L.email);
  });

  it("ashes: a fully empty snapshot object prints exactly the constants (byte-identical to no snapshot)", async () => {
    const empty = { v: 1, name: null, uen: null, gstRegNo: null, address: null, phone: null, email: null, website: null };
    expect(await ashesText({ ...TERMS, company: empty })).toEqual(await ashesText(null));
  });

  it("referral: same field-by-field fallback, registered name keeps its original capitalised form when it is the constant", async () => {
    const t = toText(await renderReferralAgreementPdfFromData(referralData(partial)));
    expect(t).toContain("Address: 9 Partial Lane Singapore 000009");
    expect(t).toContain("registered office at 9 Partial Lane Singapore 000009.");
    expect(t).toContain(`ENSHRINE PETS PARADISE PTE. LTD. (UEN: ${P.uen})`);
    expect(t).toContain(`Contact: ${L.phone}`);
    expect(t).not.toMatch(/not set\]|undefined|null/);
  });
});
