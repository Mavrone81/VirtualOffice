// Company details as printed on generated documents (invoice, quotation).
//
// Fallback chain for every value: company field -> LEGACY_DOCUMENT_DEFAULTS
// (what the documents printed before this was fillable) -> visible
// "[<what> not set]" marker. A value is NEVER rendered as a blank, and on day
// one (all columns null) nothing falls through to a marker.
//
// Two distinct registration numbers: the company UEN (header, footer) and the
// company PayNow UEN (the invoice's PayNow payment line). They may differ and
// each falls back on its own.

export type CompanyIdentityRow = {
  name: string;
  legalName: string | null;
  address: string | null;
  uen: string | null;
  paynowUen: string | null;
  /** Optional: rows built before this field existed (tests, quotations) omit it. */
  gstRegNo?: string | null;
  contactEmail: string | null;
  phone: string | null;
  website: string | null;
};

export const notSet = (what: string) => `[${what} not set]`;

/**
 * LEGACY_DOCUMENT_DEFAULTS - the values invoices and quotations printed before
 * company details became fillable (lib/pdf/invoice.tsx and quotation.tsx used to
 * hold these as constants). They are kept as the SECOND step of the fallback
 * chain: company field -> these -> visible "[... not set]" marker.
 *
 * Why: the new columns are all null on deploy, and invoices go to paying
 * customers. Filling the /admin/company form must be an improvement over these,
 * never a prerequisite for a correct invoice. A marker therefore appears only
 * for something with neither a field nor a default here.
 *
 * Whether the UEN below is the right one, and whether it is the company's or
 * the holding company's, is an open question for the owner; until it is ruled,
 * this is today's behaviour, unchanged - EXCEPT the email and website below,
 * which are a deliberate correction to the owner-confirmed domain (the
 * previous values were an older, wrong domain and local part).
 */
export const LEGACY_DOCUMENT_DEFAULTS = {
  uen: "202328861K",
  /** Legal name the legacy UEN is printed against in the invoice/quotation footer. */
  uenHolder: "Enshrine Holdings Pte Ltd",
  /** Name the QUOTATION footer printed beside the UEN (it never named the holding company). */
  quotationFooterName: "Enshrine",
  /** The three-subsidiary line in the letterhead (order is part of today's output). */
  entities: "Enshrine Services Pte Ltd · Enshrine Pets Paradise Pte Ltd · Enshrine Afterlife Planner Pte Ltd",
  address: "74 Lorong 6 Geylang, Singapore 399226",
  phone: "9009 9234",
  email: "contact@enshrine.com.sg",
  website: "www.enshrine.com.sg",
} as const;


const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** The field value, else the legacy default (when there is one), else the visible marker. */
export const orMarker = (v: string | null | undefined, what: string, fallback?: string): string => clean(v) ?? fallback ?? notSet(what);

export type InvoiceUen = {
  /** Company UEN printed in the header and footer. */
  uen: string;
  /** The legal name the footer prints beside the company UEN. */
  holder: string;
  /** PayNow UEN printed on the invoice's PayNow payment line. */
  paynowUen: string;
  /** True when the company UEN is the legacy default (field unset). */
  legacy: boolean;
};

/**
 * The registration numbers printed on a company's invoice. Each is
 * field -> legacy default; there is no marker because a legacy default exists.
 *  - company UEN: the company's own number; unset -> the legacy number, which
 *    is then paired with the legacy footer name it always printed beside.
 *  - PayNow UEN: its own field; unset -> the legacy number. It deliberately
 *    does NOT fall back to the company UEN: where customers pay must not change
 *    as a side effect of filling in another field.
 * When the company UEN is set, the footer name is the company's own legal name
 * (else its name), because that is whose number it is.
 */
export function resolveInvoiceUen(c: CompanyIdentityRow): InvoiceUen {
  const own = clean(c.uen);
  const paynowUen = clean(c.paynowUen) ?? LEGACY_DOCUMENT_DEFAULTS.uen;
  if (own) return { uen: own, holder: clean(c.legalName) ?? clean(c.name) ?? LEGACY_DOCUMENT_DEFAULTS.uenHolder, paynowUen, legacy: false };
  return { uen: LEGACY_DOCUMENT_DEFAULTS.uen, holder: LEGACY_DOCUMENT_DEFAULTS.uenHolder, paynowUen, legacy: true };
}

/**
 * The GST registration number to print on a document, or null for "print
 * nothing". It prints ONLY when the document is a tax invoice (the caller's
 * own TAX INVOICE condition, passed in so there is a single source of truth
 * for it) and the company has one set.
 *
 * Deliberately NO marker when a tax invoice has no number: unlike the other
 * fields, this one has no legacy default, and every invoice printed before this
 * field existed carried no number. A "[GST registration number not set]"
 * marker would newly alter every GST-registered company's invoice on deploy,
 * which the deploy-safety rule forbids. The gap is surfaced to the Admin on
 * /admin/company instead (see gstNumberMissing).
 */
export function resolveGstRegNo(c: Pick<CompanyIdentityRow, "gstRegNo">, isTaxInvoice: boolean): string | null {
  return isTaxInvoice ? clean(c.gstRegNo) : null;
}

/** True when the company is GST-registered but has no GST registration number on file. */
export function gstNumberMissing(c: { gstRegistered: boolean; gstRegNo?: string | null }): boolean {
  return c.gstRegistered && clean(c.gstRegNo) === null;
}

/**
 * The contact block in the header of the ashes and referral agreements. It is
 * built ONLY from LEGACY_DOCUMENT_DEFAULTS (constants), never from the
 * database: these are contract documents, and a later edit on /admin/company
 * must not change the text of an agreement. Sharing the constants keeps them
 * from drifting from the invoice again. The address has always been printed
 * on agreements without the comma the invoice uses; that is preserved.
 */
export function agreementContactLine(): string {
  const L = LEGACY_DOCUMENT_DEFAULTS;
  return `Address: ${L.address.replace(",", "")}   Contact: ${L.phone}   Email: ${L.email}   Website: ${L.website}`;
}

/** "Tel: ... · Email · Website" - each part: field, else legacy default, else marker. */
export function contactLine(c: Pick<CompanyIdentityRow, "phone" | "contactEmail" | "website">): string {
  const L = LEGACY_DOCUMENT_DEFAULTS;
  return [`Tel: ${orMarker(c.phone, "phone", L.phone)}`, orMarker(c.contactEmail, "email", L.email), orMarker(c.website, "website", L.website)].join(" · ");
}

/** A value that every row agrees on; null when none is set or rows disagree. */
export function commonValue(values: (string | null | undefined)[]): string | null {
  const set = new Set(values.map(clean).filter((v): v is string => v !== null));
  return set.size === 1 ? [...set][0] : null;
}

/**
 * Letterhead for documents that are not tied to one Company (quotations).
 * Each field is the value every active company that has it set agrees on;
 * where none has it set the caller falls to the legacy default. UEN: only
 * companies whose company UEN is real data count - if none do, `uen` is null
 * with `anyData: false` (caller uses the legacy default); if they disagree,
 * `uen` is null with `anyData: true` (caller still uses the legacy default; a quotation must not print a marker). The PayNow UEN
 * is not printed on quotations and is not part of this.
 */
export function sharedIdentity(rows: CompanyIdentityRow[]) {
  const inv = rows.map(resolveInvoiceUen).filter((r) => !r.legacy);
  const uen = commonValue(inv.map((r) => r.uen));
  return {
    uen,
    uenAnyData: inv.length > 0,
    holder: uen ? commonValue(inv.filter((r) => r.uen === uen).map((r) => r.holder)) : null,
    address: commonValue(rows.map((r) => r.address)),
    phone: commonValue(rows.map((r) => r.phone)),
    contactEmail: commonValue(rows.map((r) => r.contactEmail)),
    website: commonValue(rows.map((r) => r.website)),
    entities: rows.map((r) => clean(r.legalName) ?? clean(r.name)).filter((v): v is string => v !== null),
  };
}

// ---------------------------------------------------------------------------
// Validation for the admin form (shared by the server action and its tests).
// ---------------------------------------------------------------------------

export type CompanyDetailsInput = {
  legalName?: string | null;
  address?: string | null;
  uen?: string | null;
  paynowUen?: string | null;
  gstRegNo?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  website?: string | null;
};

export type CompanyDetailsError =
  | "uenInvalid" | "paynowUenInvalid" | "gstRegNoInvalid" | "emailInvalid" | "tooLong";

export type CompanyDetailsClean = Required<CompanyDetailsInput>;

const UEN_RE = /^[0-9A-Z]{9,10}$/;
// GST registration numbers come in more than one shape (a UEN-style number, or
// the older letter-digit-hyphen form), so this only checks the character set
// and length; it does not try to validate the format.
const GST_RE = /^[0-9A-Z-]{8,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims, empties to null and upper-cases the UENs and the GST registration number. */
export function cleanCompanyDetails(i: CompanyDetailsInput): { ok: true; data: CompanyDetailsClean } | { ok: false; error: CompanyDetailsError } {
  const t = (v: string | null | undefined) => clean(v);
  const data: CompanyDetailsClean = {
    legalName: t(i.legalName),
    address: t(i.address),
    uen: t(i.uen)?.toUpperCase() ?? null,
    paynowUen: t(i.paynowUen)?.toUpperCase() ?? null,
    gstRegNo: t(i.gstRegNo)?.toUpperCase() ?? null,
    contactEmail: t(i.contactEmail),
    phone: t(i.phone),
    website: t(i.website),
  };
  for (const [k, max] of [["legalName", 200], ["address", 300], ["contactEmail", 254], ["phone", 40], ["website", 200]] as const) {
    if ((data[k]?.length ?? 0) > max) return { ok: false, error: "tooLong" };
  }
  if (data.uen && !UEN_RE.test(data.uen)) return { ok: false, error: "uenInvalid" };
  if (data.paynowUen && !UEN_RE.test(data.paynowUen)) return { ok: false, error: "paynowUenInvalid" };
  if (data.gstRegNo && !GST_RE.test(data.gstRegNo)) return { ok: false, error: "gstRegNoInvalid" };
  if (data.contactEmail && !EMAIL_RE.test(data.contactEmail)) return { ok: false, error: "emailInvalid" };
  return { ok: true, data };
}
