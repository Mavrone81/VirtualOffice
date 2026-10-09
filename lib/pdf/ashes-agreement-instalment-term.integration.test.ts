// The live defect this fixes: the agreement's prose hardcoded "12 Months"
// regardless of the sale's actual instalment term. A test that only ever
// sees a 12-month fixture cannot tell a hardcoded 12 from a derived one —
// which is exactly how this shipped — so this fixture is deliberately an
// 18-month sale. REQUIRES poppler-utils (`pdftotext`): reads what was
// actually printed, same convention as agreement-contact-block.integration.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { petsAshesAgreement: { findUnique: vi.fn() }, company: { findMany: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage", () => ({ getObject: vi.fn(async () => null) }));

import { renderAshesAgreementPdf } from "./ashes-agreement";

function toText(buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "agr-term-"));
  try {
    const f = join(dir, "o.pdf");
    writeFileSync(f, buffer);
    return execFileSync("pdftotext", [f, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// An 18-month sale -- deliberately not 12, not 24 -- on Installment, with a
// real booking fee, monthly figure and instalment day, exactly the shape
// createAshesDraftTx / saveAshesAgreement / signAshesAgreement all produce.
const installmentRow = (instalmentMonths: number | null) => ({
  id: "a1", submission: { clientName: "Test Client" }, storageSpaceLocation: "X", nicheUnit: "1", pets: [], applicant1Name: "Test Applicant",
  applicant1Nric: null, applicant1Address: "1 Example Road", applicant1Contact: "000", applicant1Email: "a@example.invalid", applicant2Name: null, applicant2Nric: null,
  applicant2Address: null, applicant2Contact: null, applicant2Email: null, amountNumeric: { toFixed: () => "1800.00" }, amountWords: "One thousand eight hundred",
  paymentPlan: "Installment",
  bookingFee: { toFixed: () => "50.00" },
  monthlyInstalment: { toFixed: () => "97.22" },
  instalmentMonths,
  instalmentDayOfMonth: 5,
  maintenanceStartYear: 2027, additionalTerms: null,
  signedAt: null, applicantSignatureKey: null, applicantWitnessName: null, applicantWitnessNric: null, companyWitnessName: null, companyWitnessNric: null,
});

beforeEach(() => vi.clearAllMocks());

describe("ashes agreement renders the SALE'S actual instalment term, not a hardcoded 12", () => {
  it("an 18-month sale prints 18, both in the heading bullet and the 'period of N calendar months' clause", async () => {
    prismaMock.petsAshesAgreement.findUnique.mockResolvedValue(installmentRow(18));
    const t = toText((await renderAshesAgreementPdf("a1"))!.buffer);
    expect(t).toContain("18 Months Interest Free Instalment");
    expect(t).toContain("period of 18 calendar months");
    expect(t).not.toContain("12 Months Interest Free Instalment");
    expect(t).not.toContain("period of 12 calendar months");
  });

  it("a DIFFERENT term (6 months) on a different render also prints its own number — not a fixture-specific coincidence", async () => {
    prismaMock.petsAshesAgreement.findUnique.mockResolvedValue(installmentRow(6));
    const t = toText((await renderAshesAgreementPdf("a1"))!.buffer);
    expect(t).toContain("6 Months Interest Free Instalment");
    expect(t).toContain("period of 6 calendar months");
  });

  it("a pre-migration row with no backfilled term (null) renders the blank fallback, not a silent 12", async () => {
    prismaMock.petsAshesAgreement.findUnique.mockResolvedValue(installmentRow(null));
    const t = toText((await renderAshesAgreementPdf("a1"))!.buffer);
    expect(t).not.toContain("12 Months Interest Free Instalment");
    expect(t).not.toContain("period of 12 calendar months");
    expect(t).toContain("____ Months Interest Free Instalment");
  });

  it("a FullPayment sale (isFull) shows the blank-line fallback for the booking fee regardless of instalmentMonths", async () => {
    prismaMock.petsAshesAgreement.findUnique.mockResolvedValue({ ...installmentRow(18), paymentPlan: "FullPayment" });
    const t = toText((await renderAshesAgreementPdf("a1"))!.buffer);
    expect(t).toContain("Booking Fee for the amount of (S$________________)");
  });
});
