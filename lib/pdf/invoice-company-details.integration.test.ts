import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// REQUIRES poppler-utils (`pdftotext`), like the other PDF integration tests:
// an independent read of what was actually printed, not the renderer's input.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { invoice: { findUnique: vi.fn() }, company: { findMany: vi.fn() }, salesSubmission: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { renderQuotationPdf } from "@/lib/pdf/quotation";
import { LEGACY_DOCUMENT_DEFAULTS as L } from "@/lib/company-identity";

// Obviously-fake placeholders only.
const FAKE_UEN = "000000000A";
const FAKE_PAYNOW = "111111111B";

const company = (o: Record<string, unknown>) => ({
  id: "c1", name: "Example Co", legalName: "Example Co Pte Ltd", address: null, invoicePrefix: "EX", gstRegistered: false, gstRate: 0, active: true,
  uen: null, paynowUen: null, contactEmail: null, phone: null, website: null, ...o,
});

function invoiceFor(c: Record<string, unknown>) {
  return {
    id: "i1", companyId: "c1", company: c, invoiceNumber: "EX-0001", createdAt: new Date("2026-01-05"), status: "Issued", paidDate: null,
    installmentIndex: null, amount: 100,
    transaction: {
      clientName: "Test Client", clientContact: null, transactionCode: "TXN-1", submission: null, lineItems: [],
      closingAssociate: { fullName: "Test Associate", associateCode: "EN9999", businessName: null, teamName: null },
    },
  };
}

function toText(buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "invco-"));
  try {
    const f = join(dir, "o.pdf");
    writeFileSync(f, buffer);
    // whitespace collapsed so a legacy value that wraps across lines still matches
    return execFileSync("pdftotext", [f, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function invoiceText(c: Record<string, unknown>): Promise<string> {
  prismaMock.invoice.findUnique.mockResolvedValue(invoiceFor(c));
  prismaMock.company.findMany.mockResolvedValue([c]);
  return toText((await renderInvoicePdf("i1"))!.buffer);
}

async function quotationText(companies: Record<string, unknown>[]): Promise<string> {
  prismaMock.company.findMany.mockResolvedValue(companies);
  prismaMock.salesSubmission.findUnique.mockResolvedValue({
    id: "s1", createdAt: new Date("2026-01-05"), salesDate: new Date("2026-01-05"), clientName: "Test Client", clientContact: null,
    paymentPlan: "OneTime", installmentCount: null, deposit: null, saleAmount: 100, lineItems: [{ productName: "Item", lineSaleAmount: 100 }],
    closingAssociate: { fullName: "Test Associate", associateCode: "EN9999", businessName: null, teamName: null },
    transaction: { transactionCode: "TXN-1" },
  });
  return toText((await renderQuotationPdf("s1"))!.buffer);
}

beforeEach(() => vi.clearAllMocks());

describe("deploy safety: ALL company columns null prints today's document, no marker (2 documents examined)", () => {
  const legacyValues = [L.uen, L.address, L.phone, L.email, L.website, // The right-hand column can interleave with a wrapped entity name, so the
  // last word ("Ltd") is dropped from each name before matching.
  ...L.entities.split(" · ").map((e) => e.replace(/ Ltd$/, ""))];

  it("invoice", async () => {
    const t = await invoiceText(company({}));
    for (const v of legacyValues) expect(t, "missing legacy value (" + v.length + " chars)").toContain(v);
    expect(t).toContain("PayNow (Company UEN): " + L.uen);
    expect(t).toContain(`${L.uenHolder} · UEN ${L.uen}`);
    expect(t).not.toMatch(/\[[^\]]*(not set|not chosen)\]/);
    expect(t).not.toContain("[");
  });

  it("quotation", async () => {
    // three companies, all columns null, as on day one
    const t = await quotationText([company({ id: "a" }), company({ id: "b" }), company({ id: "c" })]);
    for (const v of legacyValues) expect(t, "missing legacy value (" + v.length + " chars)").toContain(v);
    expect(t).toContain(`${L.quotationFooterName} · UEN ${L.uen}`);
    expect(t).not.toContain("[");
  });
});

// The email and website were deliberately corrected to the owner-confirmed
// domain. Everything else printed with all columns null must be exactly what the
// base commit printed. The base text was extracted from the base commit's own
// render (same fixture) and the whole page text is pinned below, built from the
// legacy constants, so any layout, wording or ordering change fails here.
const OLD_EMAIL = "contacts@enshrine.sg";
const OLD_WEBSITE = "www.enshrine.sg";

describe("all columns null: whole-document text is pinned; only email + website differ from base", () => {
  const ent = L.entities.replace(/ Ltd$/, "");
  const INVOICE =
    `ENSHRINE INVOICE ${ent} Invoice No. EX-0001 Ltd Issue Date 05 Jan 2026 ${L.address} Due Date 19 Jan 2026 UEN ${L.uen} Tel: ${L.phone} · ${L.email} · ${L.website} ` +
    `B I L L TO S A L E S A S S O C I AT E Test Client Test Associate Associate ID: EN9999 NO. DESCRIPTION QTY UNIT PRICE AMOUNT 1 Sale — TXN-1 1 S$100.00 S$100.00 ` +
    `Subtotal S$100.00 GST (if applicable) S$0.00 Total Payable S$100.00 Test Client PAY M E N T P L A N One-time payment — full amount due by 19 Jan 2026. ` +
    `PAY M E N T M E T H O D S I M P O R TA N T • PayNow (Company UEN): ${L.uen} Please quote the Invoice Number (and your name) as the payment • Bank Transfer: Bank / Account No. ` +
    `reference so we can match your payment. • Cheque payable to: Example Co Reference required: EX-0001 Authorised Signature (Company) Customer Acknowledgement ` +
    `This is a system-generated invoice from the Virtual Office platform. ${L.uenHolder} · UEN ${L.uen}`;
  const QUOTATION =
    `ENSHRINE ${ent} QUOTATION Quotation No. TXN-1 Date 05 Jan 2026 Valid Until 04 Feb 2026 UEN ${L.uen} Ltd ${L.address} Tel: ${L.phone} · ${L.email} · ${L.website} ` +
    `P R E PA R E D F O R S A L E S A S S O C I AT E Test Client Test Associate Associate ID: EN9999 NO. DESCRIPTION AMOUNT 1 Item S$100.00 Total PAY M E N T P L A N One-time full payment. ` +
    `This quotation is an estimate and is not a demand for payment. An invoice will be issued upon confirmation. Client acceptance (name & signature) Date ` +
    `System-generated quotation from the Virtual Office platform. ${L.quotationFooterName} · UEN ${L.uen} · Valid until 04 Feb 2026 S$100.00`;

  it("legacy email/website are the corrected domain, not the old one", () => {
    expect(L.email).toBe("contact@enshrine.com.sg");
    expect(L.website).toBe("www.enshrine.com.sg");
  });

  it("invoice: full text matches; corrected values present, old values absent, no marker", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
    try {
      const t = (await invoiceText(company({}))).trim();
      expect(t).toBe(INVOICE);
      expect(t).toContain(L.email);
      expect(t).toContain(L.website);
      expect(t).not.toContain(OLD_EMAIL);
      expect(t).not.toContain(OLD_WEBSITE);
      expect(t).not.toContain("[");
    } finally {
      vi.useRealTimers();
    }
  });

  it("quotation: full text matches; corrected values present, old values absent, no marker", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
    try {
      const t = (await quotationText([company({ id: "a" }), company({ id: "b" }), company({ id: "c" })])).trim();
      expect(t).toBe(QUOTATION);
      expect(t).toContain(L.email);
      expect(t).toContain(L.website);
      expect(t).not.toContain(OLD_EMAIL);
      expect(t).not.toContain(OLD_WEBSITE);
      expect(t).not.toContain("[");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("invoice PDF with company details filled (4 rendered documents examined)", () => {
  it("company UEN and PayNow UEN set to DIFFERENT values: each prints in its own place, neither in the other's", async () => {
    const t = await invoiceText(company({ uen: FAKE_UEN, paynowUen: FAKE_PAYNOW, address: "1 Example Road", phone: "000", contactEmail: "a@example.invalid", website: "example.invalid" }));
    expect(t).toContain("PayNow (Company UEN): " + FAKE_PAYNOW);
    expect(t).not.toContain("PayNow (Company UEN): " + FAKE_UEN);
    expect(t).toContain("Example Co Pte Ltd · UEN " + FAKE_UEN);
    expect(t).toMatch(new RegExp("UEN " + FAKE_UEN + "\\b"));
    // The company UEN appears in the header + footer only (2x); the PayNow UEN only on the PayNow line (1x).
    expect(t.split(FAKE_UEN)).toHaveLength(3);
    expect(t.split(FAKE_PAYNOW)).toHaveLength(2);
    expect(t).not.toContain(L.uen);
    expect(t).not.toContain(L.address);
    expect(t).not.toContain(L.phone);
    expect(t).toContain("1 Example Road");
    expect(t).toContain("a@example.invalid");
    expect(t).not.toContain("[");
  });
  it("only the company UEN set: it prints in header/footer; PayNow falls back to the legacy number", async () => {
    const t = await invoiceText(company({ uen: FAKE_UEN }));
    expect(t).toContain("PayNow (Company UEN): " + L.uen);
    expect(t.split(FAKE_UEN)).toHaveLength(3);
    expect(t).toContain("Example Co Pte Ltd · UEN " + FAKE_UEN);
    expect(t).toContain(L.address);
    expect(t).not.toContain("[");
  });
  it("only the PayNow UEN set: it prints on the PayNow line; header/footer stay on the legacy company number", async () => {
    const t = await invoiceText(company({ paynowUen: FAKE_PAYNOW }));
    expect(t).toContain("PayNow (Company UEN): " + FAKE_PAYNOW);
    expect(t.split(FAKE_PAYNOW)).toHaveLength(2);
    expect(t).toContain(`${L.uenHolder} · UEN ${L.uen}`);
    expect(t).not.toContain("[");
  });
  it("quotation: prints the company UEN, never the PayNow UEN", async () => {
    const t = await quotationText([company({ id: "a", uen: FAKE_UEN, paynowUen: FAKE_PAYNOW })]);
    expect(t).toContain(FAKE_UEN);
    expect(t).not.toContain(FAKE_PAYNOW);
    expect(t).not.toContain("[");
  });
  it("quotation with three companies holding three DIFFERENT UENs: no marker, prints the legacy pair (3 companies examined)", async () => {
    const cos = [company({ id: "a", uen: FAKE_UEN }), company({ id: "b", uen: "222222222C" }), company({ id: "c", uen: "333333333D" })];
    expect(cos).toHaveLength(3);
    const t = await quotationText(cos);
    expect(t).not.toContain("[");
    expect(t).toContain(`${L.quotationFooterName} · UEN ${L.uen}`);
    for (const u of [FAKE_UEN, "222222222C", "333333333D"]) expect(t).not.toContain(u);
  });
});

describe("GST registration number on invoices (6 rendered invoices examined)", () => {
  const FAKE_GST = "M2-0000000-0";
  const tax = { gstRegistered: true, gstRate: 9 };

  it("tax invoice with a number: title is TAX INVOICE and the number prints once", async () => {
    const t = await invoiceText(company({ ...tax, gstRegNo: FAKE_GST }));
    expect(t).toContain("TAX INVOICE");
    expect(t).toContain("GST Reg. No. " + FAKE_GST);
    expect(t.split(FAKE_GST)).toHaveLength(2);
  });
  it("tax invoice, number NOT set: identical text to a tax invoice with the column absent, no marker, no label", async () => {
    const withNull = await invoiceText(company({ ...tax, gstRegNo: null }));
    const { gstRegNo: _omit, ...legacyShape } = company(tax) as Record<string, unknown>;
    void _omit;
    const absent = await invoiceText(legacyShape);
    expect(withNull).toBe(absent);
    expect(withNull).toContain("TAX INVOICE");
    expect(withNull).not.toContain("GST Reg");
    expect(withNull).not.toContain("[");
  });
  it("plain invoice (not GST-registered) never prints the number even when one is stored", async () => {
    const t = await invoiceText(company({ gstRegistered: false, gstRate: 0, gstRegNo: FAKE_GST }));
    expect(t).not.toContain("TAX INVOICE");
    expect(t).not.toContain(FAKE_GST);
    expect(t).not.toContain("GST Reg");
  });
  it("registered but rate 0 is not a tax invoice, so no number (the same condition as the title)", async () => {
    const t = await invoiceText(company({ gstRegistered: true, gstRate: 0, gstRegNo: FAKE_GST }));
    expect(t).not.toContain("TAX INVOICE");
    expect(t).not.toContain(FAKE_GST);
  });
  it("quotation never prints the number (1 quotation, GST-registered company with a number)", async () => {
    const t = await quotationText([company({ ...tax, gstRegNo: FAKE_GST })]);
    expect(t).not.toContain(FAKE_GST);
    expect(t).not.toContain("GST Reg");
  });
  it("a number-bearing invoice differs from the null one only by the added label and value", async () => {
    const a = await invoiceText(company({ ...tax, gstRegNo: null }));
    const b = await invoiceText(company({ ...tax, gstRegNo: FAKE_GST }));
    expect(b.replace(" GST Reg. No. " + FAKE_GST, "").replace(FAKE_GST, "")).toBe(a.replace(" GST Reg. No.", ""));
  });
});
