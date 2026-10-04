import { describe, it, expect } from "vitest";
import {
  resolveInvoiceUen, resolveGstRegNo, gstNumberMissing, agreementContactLine, snapshotAgreementCompany, readAgreementCompanySnapshot, resolveAgreementCompany, AGREEMENT_PARTY_DEFAULTS, contactLine, commonValue, sharedIdentity, cleanCompanyDetails, notSet, LEGACY_DOCUMENT_DEFAULTS,
  type CompanyIdentityRow,
} from "./company-identity";

// Obviously-fake placeholders only. Nothing here is a real registration
// number, address, phone number or email.
const FAKE_UEN = "000000000A";
const FAKE_PAYNOW = "111111111B";

const row = (o: Partial<CompanyIdentityRow> = {}): CompanyIdentityRow => ({
  name: "Example Co", legalName: "Example Co Pte Ltd", address: null, uen: null, paynowUen: null,
  contactEmail: null, phone: null, website: null, ...o,
});

describe("resolveInvoiceUen - company UEN and PayNow UEN are independent", () => {
  // Each case is one company row; the table is asserted non-empty first so an
  // empty fixture cannot manufacture a green.
  const cases: { label: string; row: CompanyIdentityRow; uen: string; paynow: string; holder: string }[] = [
    { label: "both set and different", row: row({ uen: FAKE_UEN, paynowUen: FAKE_PAYNOW }), uen: FAKE_UEN, paynow: FAKE_PAYNOW, holder: "Example Co Pte Ltd" },
    { label: "only company UEN set -> PayNow falls back to the legacy number, NOT to the company UEN", row: row({ uen: FAKE_UEN }), uen: FAKE_UEN, paynow: LEGACY_DOCUMENT_DEFAULTS.uen, holder: "Example Co Pte Ltd" },
    { label: "only PayNow UEN set -> company UEN falls back to legacy with its legacy footer name", row: row({ paynowUen: FAKE_PAYNOW }), uen: LEGACY_DOCUMENT_DEFAULTS.uen, paynow: FAKE_PAYNOW, holder: LEGACY_DOCUMENT_DEFAULTS.uenHolder },
    { label: "neither set -> both legacy (deploy safety)", row: row(), uen: LEGACY_DOCUMENT_DEFAULTS.uen, paynow: LEGACY_DOCUMENT_DEFAULTS.uen, holder: LEGACY_DOCUMENT_DEFAULTS.uenHolder },
    { label: "whitespace-only counts as unset", row: row({ uen: "   ", paynowUen: " " }), uen: LEGACY_DOCUMENT_DEFAULTS.uen, paynow: LEGACY_DOCUMENT_DEFAULTS.uen, holder: LEGACY_DOCUMENT_DEFAULTS.uenHolder },
    { label: "company UEN set, no legal name -> footer name is the company name", row: row({ uen: FAKE_UEN, legalName: null }), uen: FAKE_UEN, paynow: LEGACY_DOCUMENT_DEFAULTS.uen, holder: "Example Co" },
  ];

  it("examines 6 rows (fixture is not empty)", () => {
    expect(cases).toHaveLength(6);
  });

  for (const c of cases) {
    it(c.label, () => {
      const r = resolveInvoiceUen(c.row);
      expect(r.uen).toBe(c.uen);
      expect(r.paynowUen).toBe(c.paynow);
      expect(r.holder).toBe(c.holder);
    });
  }

  it("no marker on any of the 6 rows: every printed number is non-empty", () => {
    const rs = cases.map((c) => resolveInvoiceUen(c.row));
    expect(rs).toHaveLength(6);
    for (const r of rs) for (const v of [r.uen, r.paynowUen, r.holder]) {
      expect(v.trim().length).toBeGreaterThan(0);
      expect(v.startsWith("[")).toBe(false);
    }
  });
});

describe("letterhead helpers", () => {
  it("contactLine: field, else legacy default, never a marker (3 fields x 3 states)", () => {
    const L = LEGACY_DOCUMENT_DEFAULTS;
    expect(contactLine({ phone: null, contactEmail: null, website: null })).toBe(`Tel: ${L.phone} · ${L.email} · ${L.website}`);
    expect(contactLine({ phone: "000", contactEmail: null, website: null })).toBe(`Tel: 000 · ${L.email} · ${L.website}`);
    expect(contactLine({ phone: "000", contactEmail: "a@example.invalid", website: "example.invalid" })).toBe("Tel: 000 · a@example.invalid · example.invalid");
  });

  it("commonValue: one agreed value only; none / disagreement -> null", () => {
    expect(commonValue(["x", " x ", null])).toBe("x");
    expect(commonValue(["x", "y"])).toBeNull();
    expect(commonValue([null, ""])).toBeNull();
    expect(commonValue([])).toBeNull();
  });

  it("sharedIdentity (quotation letterhead) over 3 companies", () => {
    const rows = [
      row({ name: "A", legalName: null }),
      row({ name: "B", uen: FAKE_UEN, address: "1 Example Road" }),
      row({ name: "C", uen: FAKE_UEN, paynowUen: FAKE_PAYNOW, address: "1 Example Road" }),
    ];
    // A has none set (legacy, ignored); B and C share the same company UEN. PayNow is irrelevant to it.
    const s = sharedIdentity(rows);
    expect(rows).toHaveLength(3);
    expect(s.uen).toBe(FAKE_UEN);
    expect(s.address).toBe("1 Example Road");
    // Real data that disagrees -> not guessed (caller prints a marker).
    const dis = sharedIdentity([row({ uen: FAKE_UEN }), row({ uen: "222222222C" })]);
    expect(dis.uen).toBeNull();
    expect(dis.uenAnyData).toBe(true);
    // A PayNow UEN alone is not company-UEN data.
    const pn = sharedIdentity([row({ paynowUen: FAKE_PAYNOW }), row()]);
    expect(pn.uen).toBeNull();
    expect(pn.uenAnyData).toBe(false);
    // Nothing set anywhere -> null with no data (caller uses the legacy default, not a marker).
    const none = sharedIdentity([row(), row()]);
    expect(none.uen).toBeNull();
    expect(none.uenAnyData).toBe(false);
    expect(notSet("UEN")).toBe("[UEN not set]");
  });
});

describe("cleanCompanyDetails (admin form validation)", () => {
  it("accepts two different UENs, normalising case and blanks", () => {
    const r = cleanCompanyDetails({ uen: " 00000000a ", paynowUen: FAKE_PAYNOW.toLowerCase(), phone: "  ", contactEmail: "a@example.invalid" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.uen).toBe("00000000A");
      expect(r.data.paynowUen).toBe(FAKE_PAYNOW);
      expect(r.data.phone).toBeNull();
    }
  });
  it("accepts one UEN, the other one, and neither", () => {
    expect(cleanCompanyDetails({ uen: FAKE_UEN }).ok).toBe(true);
    expect(cleanCompanyDetails({ paynowUen: FAKE_PAYNOW }).ok).toBe(true);
    expect(cleanCompanyDetails({}).ok).toBe(true);
  });
  it("rejects a bad company UEN, a bad PayNow UEN, bad email, over-long text", () => {
    const bad = [
      cleanCompanyDetails({ uen: "not a uen!" }),
      cleanCompanyDetails({ paynowUen: "not a uen!" }),
      cleanCompanyDetails({ contactEmail: "nope" }),
      cleanCompanyDetails({ phone: "9".repeat(41) }),
    ];
    expect(bad).toHaveLength(4);
    expect(bad.map((b) => (b.ok ? "ok" : b.error))).toEqual(["uenInvalid", "paynowUenInvalid", "emailInvalid", "tooLong"]);
  });
});

describe("GST registration number", () => {
  const FAKE_GST = "M2-0000000-0";
  it("prints only on a tax invoice and only when set (4 cases examined)", () => {
    const cases: [string, string | null, boolean, string | null][] = [
      ["tax invoice, set", FAKE_GST, true, FAKE_GST],
      ["tax invoice, set with padding", `  ${FAKE_GST} `, true, FAKE_GST],
      ["tax invoice, not set -> nothing (no marker)", null, true, null],
      ["not a tax invoice, set -> nothing", FAKE_GST, false, null],
    ];
    expect(cases).toHaveLength(4);
    for (const [label, v, tax, want] of cases) expect(resolveGstRegNo({ gstRegNo: v }, tax), label).toBe(want);
  });
  it("never yields a marker or blank string (3 unset shapes examined)", () => {
    for (const v of [null, undefined, "   "]) expect(resolveGstRegNo({ gstRegNo: v }, true)).toBeNull();
  });
  it("gstNumberMissing: true only for registered-without-number (4 combinations examined)", () => {
    expect(gstNumberMissing({ gstRegistered: true, gstRegNo: null })).toBe(true);
    expect(gstNumberMissing({ gstRegistered: true, gstRegNo: " " })).toBe(true);
    expect(gstNumberMissing({ gstRegistered: true, gstRegNo: FAKE_GST })).toBe(false);
    expect(gstNumberMissing({ gstRegistered: false, gstRegNo: null })).toBe(false);
  });
  it("validation: accepts a hyphenated number (upper-cased), rejects bad characters and length (3 inputs examined)", () => {
    const ok = cleanCompanyDetails({ gstRegNo: "m2-0000000-0" });
    expect(ok.ok && ok.data.gstRegNo).toBe("M2-0000000-0");
    expect(cleanCompanyDetails({ gstRegNo: "bad number!" })).toEqual({ ok: false, error: "gstRegNoInvalid" });
    expect(cleanCompanyDetails({ gstRegNo: "A1" })).toEqual({ ok: false, error: "gstRegNoInvalid" });
  });
  it("agreementContactLine is the invoice constants, no comma in the address (1 line examined)", () => {
    const l = agreementContactLine();
    expect(l).toContain(LEGACY_DOCUMENT_DEFAULTS.email);
    expect(l).toContain(LEGACY_DOCUMENT_DEFAULTS.website);
    expect(l).toContain(LEGACY_DOCUMENT_DEFAULTS.phone);
    expect(l).not.toContain(",");
  });
});

describe("agreement company snapshot", () => {
  const full = { legalName: "Example Co Pte Ltd", address: "1 Example Road, Singapore 000001", uen: FAKE_UEN, gstRegNo: "M0-0000001-0", contactEmail: "hello@example.invalid", phone: "0000 0001", website: "www.example.invalid" };
  const none = { legalName: null, address: null, uen: null, gstRegNo: null, contactEmail: null, phone: null, website: null };

  it("snapshot of a filled row stores every field as printed; the address is kept as typed (1 row examined)", () => {
    expect(snapshotAgreementCompany(full)).toEqual({ v: 1, name: "Example Co Pte Ltd", uen: FAKE_UEN, gstRegNo: "M0-0000001-0", address: "1 Example Road, Singapore 000001", phone: "0000 0001", email: "hello@example.invalid", website: "www.example.invalid" });
  });

  it("snapshot of an empty row, a missing row and a whitespace row freezes the constants (3 rows examined)", () => {
    const L = LEGACY_DOCUMENT_DEFAULTS;
    const expected = { v: 1, name: AGREEMENT_PARTY_DEFAULTS.name, uen: AGREEMENT_PARTY_DEFAULTS.uen, gstRegNo: null, address: L.address.replace(",", ""), phone: L.phone, email: L.email, website: L.website };
    expect(snapshotAgreementCompany(none)).toEqual(expected);
    expect(snapshotAgreementCompany(null)).toEqual(expected);
    expect(snapshotAgreementCompany({ ...none, legalName: "  ", phone: " " })).toEqual(expected);
  });

  it("registered name is the legal name only: a short display name is never used (1 row examined)", () => {
    expect(snapshotAgreementCompany({ ...none, legalName: null }).name).toBe(AGREEMENT_PARTY_DEFAULTS.name);
  });

  it("no snapshot resolves to exactly the constants the templates printed before, character for character (3 inputs examined)", () => {
    for (const none_ of [undefined, null, snapshotAgreementCompany(null)]) {
      const r = resolveAgreementCompany(none_);
      expect(r.name).toBe("Enshrine Pets Paradise Pte Ltd");
      expect(r.uen).toBe("202328981K");
      expect(r.address).toBe("74 Lorong 6 Geylang Singapore 399226");
      expect(r.contactLine).toBe("Address: 74 Lorong 6 Geylang Singapore 399226   Contact: 9009 9234   Email: contact@enshrine.com.sg   Website: www.enshrine.com.sg");
      expect(agreementContactLine(none_)).toBe(r.contactLine);
    }
    expect(agreementContactLine()).toBe(resolveAgreementCompany().contactLine);
  });

  it("round-trips through JSON; a foreign version, non-object, array or null reads as no snapshot (6 inputs examined)", () => {
    const snap = snapshotAgreementCompany(full);
    expect(readAgreementCompanySnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    for (const bad of [null, undefined, "x", 3, [snap], { ...snap, v: 2 }]) expect(readAgreementCompanySnapshot(bad)).toBeNull();
  });

  it("non-string or blank fields read as unset and fall back per field (1 record examined)", () => {
    const r = readAgreementCompanySnapshot({ v: 1, name: 5, uen: "  ", address: "9 Partial Lane", phone: null, email: "p@example.invalid" });
    expect(r).toEqual({ v: 1, name: null, uen: null, gstRegNo: null, address: "9 Partial Lane", phone: null, email: "p@example.invalid", website: null });
    expect(resolveAgreementCompany(r).contactLine).toBe(`Address: 9 Partial Lane   Contact: ${LEGACY_DOCUMENT_DEFAULTS.phone}   Email: p@example.invalid   Website: ${LEGACY_DOCUMENT_DEFAULTS.website}`);
  });
});
