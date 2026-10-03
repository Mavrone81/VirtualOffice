import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// REQUIRES poppler-utils (`pdftotext`): reads what was actually printed.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { petsAshesAgreement: { findUnique: vi.fn() }, company: { findMany: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage", () => ({ getObject: vi.fn(async () => null) }));

import { renderAshesAgreementPdf } from "@/lib/pdf/ashes-agreement";
import { renderReferralAgreementPdfFromData } from "@/lib/pdf/referral-agreement";
import { agreementContactLine, LEGACY_DOCUMENT_DEFAULTS as L } from "@/lib/company-identity";

const OLD_EMAIL = "contacts@enshrine.sg";
const OLD_WEBSITE = "www.enshrine.sg";

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

const referral = () =>
  renderReferralAgreementPdfFromData({
    agreementDate: null, vendorName: "Example Vendor", vendorUen: null, vendorAddress: null, vendorSignerName: null, vendorSignerNric: null,
    vendorSignerDesignation: null, vendorSignatureDataUrl: null, vendorSignedDate: null, companySignName: null, companySignDesignation: null,
    companySignatureDataUrl: null, companySignedAt: null,
  });

const ashesRow = () => ({
  id: "a1", submission: { clientName: "Test Client" }, storageSpaceLocation: "X", nicheUnit: "1", pets: [], applicant1Name: "Test Applicant",
  applicant1Nric: null, applicant1Address: "1 Example Road", applicant1Contact: "000", applicant1Email: "a@example.invalid", applicant2Name: null, applicant2Nric: null,
  applicant2Address: null, applicant2Contact: null, applicant2Email: null, amountNumeric: { toFixed: () => "100.00" }, amountWords: "One hundred",
  paymentPlan: "FullPayment", bookingFee: null, monthlyInstalment: null, instalmentDayOfMonth: null, maintenanceStartYear: null, additionalTerms: null,
  signedAt: null, applicantSignatureKey: null, applicantWitnessName: null, applicantWitnessNric: null, companyWitnessName: null, companyWitnessNric: null,
});

beforeEach(() => vi.clearAllMocks());

describe("agreement contact block matches what invoices print (2 rendered documents examined)", () => {
  it("shared line is built from the invoice constants: corrected email and website, phone and address unchanged", () => {
    const line = agreementContactLine();
    expect(line).toContain(`Email: ${L.email}`);
    expect(line).toContain(`Website: ${L.website}`);
    expect(line).toContain(`Contact: ${L.phone}`);
    expect(line).toBe("Address: 74 Lorong 6 Geylang Singapore 399226   Contact: 9009 9234   Email: contact@enshrine.com.sg   Website: www.enshrine.com.sg");
  });

  it("the block is constants only: rendering reads no company row (0 company reads across 2 renders)", async () => {
    prismaMock.petsAshesAgreement.findUnique.mockResolvedValue(ashesRow());
    await renderAshesAgreementPdf("a1");
    await referral();
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
  });

  it("referral agreement prints the corrected email and website, not the old ones", async () => {
    const t = toText(await referral());
    expect(t).toContain(L.email);
    expect(t).toContain(L.website);
    expect(t).not.toContain(OLD_EMAIL);
    expect(t).not.toContain(OLD_WEBSITE);
  });

  it("ashes agreement prints the corrected email and website, not the old ones", async () => {
    prismaMock.petsAshesAgreement.findUnique.mockResolvedValue(ashesRow());
    const t = toText((await renderAshesAgreementPdf("a1"))!.buffer);
    expect(t).toContain(L.email);
    expect(t).toContain(L.website);
    expect(t).not.toContain(OLD_EMAIL);
    expect(t).not.toContain(OLD_WEBSITE);
  });
});
