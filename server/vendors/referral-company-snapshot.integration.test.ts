// The referral agreement's company block is frozen when the VENDOR signs (at
// submission) and every later render reads it back, never re-snapshotting.
//
// WHY THIS IS THE HARD HALF. The ashes agreement is signed and rendered in one
// moment, so a snapshot taken "at signing" is unambiguous. A referral is signed
// by the vendor at submission and countersigned by an admin at approval, and
// approval RE-RENDERS and OVERWRITES the stored PDF. So there are two candidate
// moments, and only one is correct: if the snapshot were taken at approval, the
// countersigned document would print whatever /admin/company said by then, and
// would no longer match the document the vendor actually read and signed. Every
// test below edits the Company row BETWEEN those two moments, which is the only
// way the difference between the two designs is observable at all.
//
// 🔴 COMPARED ON EXTRACTED TEXT, NEVER ON BYTES. The referral renderer is not
// byte-deterministic — identical input yields different byte streams (object
// numbering races), measured on the ashes renderer at f415de1 and already the
// standard here. A byte assertion would be testing something the renderer does
// not guarantee, so it would be wrong even while passing. See
// fix/agreement-snapshot-byte-compare (be3d914), which is NOT yet in main.
//
// Real throwaway Postgres; requires poppler-utils (`pdftotext`).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import {
  AGREEMENT_COMPANY_PREFIX,
  AGREEMENT_PARTY_DEFAULTS as P,
  LEGACY_DOCUMENT_DEFAULTS as L,
  agreementContactLine,
  readAgreementCompanySnapshot,
  snapshotAgreementCompany,
  type AgreementCompanySnapshot,
} from "@/lib/company-identity";
import {
  renderReferralAgreementPdfFromData,
  renderReferralAgreementPdf,
  type ReferralAgreementData,
} from "@/lib/pdf/referral-agreement";

const TAG = "REFCO-";
const FAKE_PNG_DATA_URL = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;

// Obviously fake values; nothing here is a real company detail.
const V1 = { legalName: "Example Holdings Pte Ltd", address: "1 Example Road Singapore 000001", uen: "000000001A", gstRegNo: "M0-0000001-0", contactEmail: "hello@example.invalid", phone: "0000 0001", website: "www.example.invalid" };
const V2 = { legalName: "Changed Name Pte Ltd", address: "2 Changed Street Singapore 000002", uen: "000000002B", gstRegNo: "M0-0000002-0", contactEmail: "changed@example.invalid", phone: "0000 0002", website: "www.changed.invalid" };
const FIELDS = ["legalName", "address", "uen", "gstRegNo", "contactEmail", "phone", "website"] as const;

let submitReferralPartnership: (i: unknown) => Promise<{ ok: boolean; id?: string; error?: string }>;
let approveReferral: (id: string, i: unknown) => Promise<{ ok: boolean; error?: string }>;

let eppId = "";
let eppCreated = false;
let eppOriginal: Record<string, string | null> | null = null;
let adminUserId = "";
const referralIds: string[] = [];

const setEpp = (v: Record<string, string | null>) => prisma.company.update({ where: { id: eppId }, data: v });

/** Collapse runs of whitespace. Applied to BOTH sides of every comparison:
 *  pdftotext does not preserve the multi-space separators the contact line is
 *  built with, so an un-normalised expectation fails on spacing while the
 *  content is right. */
const norm = (s: string) => s.replace(/\s+/g, " ");

function toText(buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "refco-"));
  try {
    const f = join(dir, "o.pdf");
    writeFileSync(f, buffer);
    return norm(execFileSync("pdftotext", [f, "-"], { encoding: "utf8" }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Minimal renderer input; `company` is passed through exactly as given. */
const referralData = (company?: AgreementCompanySnapshot | null): ReferralAgreementData => ({
  agreementDate: new Date("2026-09-01T00:00:00Z"),
  vendorName: `${TAG}Vendor`, vendorUen: null, vendorAddress: null,
  vendorSignerName: `${TAG}Signer`, vendorSignerNric: null, vendorSignerDesignation: null,
  vendorSignatureDataUrl: null, vendorSignedDate: new Date("2026-09-01T00:00:00Z"),
  companySignName: null, companySignDesignation: null, companySignatureDataUrl: null, companySignedAt: null,
  ...(company === undefined ? {} : { company }),
});

/** The company strings a document is expected to print for a given row. */
function expectedCompanyStrings(row: Record<string, string | null>) {
  const snap = snapshotAgreementCompany(row as never);
  return {
    name: snap.name!,
    uen: snap.uen!,
    address: snap.address!,
    contactLine: norm(agreementContactLine(snap)),
  };
}

async function submitReferral(label: string): Promise<string> {
  who.session = { user: { id: adminUserId, role: "Admin", associateId: null } };
  const r = await submitReferralPartnership({
    vendorName: `${TAG}${label}`,
    vendorSignerName: `${TAG}Signer`,
    vendorSignerNric: "S1234567A",
    vendorUen: "000000009Z",
    vendorAddress: "9 Vendor Way Singapore 000009",
    signatureDataUrl: FAKE_PNG_DATA_URL,
    agreementRead: true,
  });
  expect(r.ok, `submission failed: ${r.error}`).toBe(true);
  referralIds.push(r.id!);
  return r.id!;
}

async function approve(id: string) {
  who.session = { user: { id: adminUserId, role: "Admin", associateId: null } };
  const r = await approveReferral(id, { companySignName: `${TAG}Admin`, companySignDesignation: "Director", signatureDataUrl: FAKE_PNG_DATA_URL });
  expect(r.ok, `approval failed: ${r.error}`).toBe(true);
}

const storedText = async (id: string) => {
  const row = await prisma.vendorReferral.findUniqueOrThrow({ where: { id } });
  const buf = await getObject(row.agreementPdfKey!);
  expect(buf, "stored agreement PDF missing").not.toBeNull();
  return toText(buf!);
};

beforeAll(async () => {
  vi.resetModules();
  ({ submitReferralPartnership, approveReferral } = (await import("./actions")) as never);

  adminUserId = (await prisma.user.create({
    data: { email: `${TAG.toLowerCase()}${Date.now()}@example.invalid`, passwordHash: "not-a-real-hash", role: "Admin" as never },
    select: { id: true },
  })).id;

  const existing = await prisma.company.findUnique({ where: { invoicePrefix: AGREEMENT_COMPANY_PREFIX } });
  if (existing) {
    eppId = existing.id;
    eppOriginal = Object.fromEntries(FIELDS.map((k) => [k, existing[k as keyof typeof existing] as string | null]));
  } else {
    eppId = (await prisma.company.create({ data: { name: `${TAG}EPP`, invoicePrefix: AGREEMENT_COMPANY_PREFIX, active: true }, select: { id: true } })).id;
    eppCreated = true;
  }
}, 120_000);

afterAll(async () => {
  // Guarded on each id: a failure in beforeAll would otherwise throw here and
  // report ITS error instead of the setup error that actually caused the run
  // to fail, which is the more useful one.
  if (referralIds.length) await prisma.vendorReferral.deleteMany({ where: { id: { in: referralIds } } });
  if (eppId) {
    if (eppCreated) await prisma.company.deleteMany({ where: { id: eppId } });
    else if (eppOriginal) await setEpp(eppOriginal);
  }
  if (adminUserId) await prisma.user.deleteMany({ where: { id: adminUserId } });
});

// ---------------------------------------------------------------------------
// PROOF 1 — the whole point.
// ---------------------------------------------------------------------------
describe("PROOF 1: company row edited between the vendor signing and the admin approving (3 documents)", () => {
  it("the approved, countersigned agreement still prints the company block the VENDOR signed — and a referral signed AFTER the edit prints the new one", async () => {
    await setEpp(V1);
    const before = expectedCompanyStrings(V1);
    const after = expectedCompanyStrings(V2);

    // 1st document: what the vendor signed, at submission, under V1.
    const id = await submitReferral("proof1");
    const signedText = await storedText(id);
    expect(signedText).toContain(before.name);
    expect(signedText).toContain(before.uen);
    expect(signedText).toContain(before.contactLine);

    // The owner edits /admin/company AFTER the vendor signed, BEFORE approval.
    await setEpp(V2);
    const row = await prisma.vendorReferral.findUniqueOrThrow({ where: { id } });
    expect(readAgreementCompanySnapshot(row.signedCompany)).toMatchObject({ v: 1, name: V1.legalName, uen: V1.uen });

    // 2nd document: the countersigned agreement that replaces it.
    await approve(id);
    const approvedText = await storedText(id);

    // It must still be the agreement the vendor signed.
    expect(approvedText).toContain(before.name);
    expect(approvedText).toContain(before.uen);
    expect(approvedText).toContain(before.contactLine);
    // And must carry none of the later edit.
    for (const v of [after.name, after.uen, V2.uen, V2.phone, V2.contactEmail, V2.website]) {
      expect(approvedText, `approved document leaked the post-signing value ${v}`).not.toContain(v);
    }
    // Control: it really is the countersigned render, not the old file left in place.
    expect(approvedText).toContain(`${TAG}Admin`);
    expect(signedText).not.toContain(`${TAG}Admin`);

    // 3rd document — DIFFERENTIAL CONTROL. Without this, a pipeline that always
    // printed V1 (or ignored the company row entirely) would pass everything
    // above. A referral signed NOW, after the edit, must print V2.
    const id2 = await submitReferral("proof1-after");
    const laterText = await storedText(id2);
    expect(laterText).toContain(after.name);
    expect(laterText).toContain(after.uen);
    expect(laterText).not.toContain(before.uen);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// PROOF 2 — legacy rows are unchanged. Demonstrated by equivalence, not claimed.
// ---------------------------------------------------------------------------
describe("PROOF 2: a row with no signedCompany renders exactly as it does today (4 documents)", () => {
  it("renderer level: passing readAgreementCompanySnapshot(null) is text-identical to the pre-change call that passed no company at all", async () => {
    // The pre-change shape is the baseline: every caller before this change
    // omitted `company` entirely. The new approval path passes
    // readAgreementCompanySnapshot(v.signedCompany), which is null for a legacy
    // row. If those two renders print the same text, legacy rows are untouched
    // — demonstrated against the actual renderer rather than asserted.
    const base: Omit<ReferralAgreementData, "company"> = {
      agreementDate: new Date("2026-09-01T00:00:00Z"),
      vendorName: `${TAG}Legacy Vendor`, vendorUen: null, vendorAddress: null,
      vendorSignerName: `${TAG}Legacy Signer`, vendorSignerNric: null, vendorSignerDesignation: null,
      vendorSignatureDataUrl: null, vendorSignedDate: new Date("2026-09-01T00:00:00Z"),
      companySignName: null, companySignDesignation: null, companySignatureDataUrl: null, companySignedAt: null,
    };

    // The live row is set to V2, so any leak would be visible in either render.
    await setEpp(V2);

    const legacyPre = toText(await renderReferralAgreementPdfFromData({ ...base }));
    const legacyNew = toText(await renderReferralAgreementPdfFromData({ ...base, company: readAgreementCompanySnapshot(null) }));

    expect(legacyPre.length).toBeGreaterThan(1000);
    expect(legacyNew).toBe(legacyPre);

    // And what they print is the constants, not the live row.
    expect(legacyPre).toContain(P.name);
    expect(legacyPre).toContain(P.uen);
    expect(legacyPre).toContain(norm(agreementContactLine()));
    for (const v of [V2.legalName, V2.uen, V2.phone, V2.contactEmail, V2.website]) {
      expect(legacyPre, `legacy render leaked live company value ${v}`).not.toContain(v);
    }
  }, 120_000);

  it("database level: a real row whose signed_company is NULL approves to the constants, with the live company row set to something else", async () => {
    await setEpp(V1);
    const id = await submitReferral("proof2-legacy");

    // Make it a pre-column row: exactly what every row submitted before this
    // migration looks like. The migration adds the column nullable with no
    // default and no backfill, so NULL is the real legacy state.
    await prisma.$executeRaw`UPDATE vendor_referrals SET signed_company = NULL WHERE id = ${id}::uuid`;
    const row = await prisma.vendorReferral.findUniqueOrThrow({ where: { id } });
    expect(row.signedCompany).toBeNull();

    await setEpp(V2); // live row differs from BOTH the constants and V1
    await approve(id);
    const text = await storedText(id);

    expect(text).toContain(P.name);
    expect(text).toContain(P.uen);
    expect(text).toContain(norm(agreementContactLine()));
    for (const v of [V1.uen, V1.legalName, V2.uen, V2.legalName, V2.phone, V2.website]) {
      expect(text, `legacy row leaked ${v}`).not.toContain(v);
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------
// PROOF 4 — a malformed snapshot cannot print as the contracting party or
// crash the render. Latent before this change (no caller supplied a snapshot);
// reachable now that submitReferralPartnership does, and the renderer is
// exported for callers that may not validate first.
// ---------------------------------------------------------------------------
describe("PROOF 4: malformed snapshots are refused by the renderer (2 documents)", () => {
  it("a right-shaped but WRONG-VERSION snapshot prints the constants, not its own values", async () => {
    // resolveAgreementCompany ignores `v` entirely, so without validation this
    // object's name and UEN would be printed as the contracting party.
    const wrongVersion = { v: "1", name: "X-WRONG-VERSION-NAME", uen: "Y-WRONG-VERSION-UEN" } as never;
    const text = toText(await renderReferralAgreementPdfFromData(referralData(wrongVersion)));
    expect(text).toContain(P.name);
    expect(text).toContain(P.uen);
    expect(text).not.toContain("X-WRONG-VERSION-NAME");
    expect(text).not.toContain("Y-WRONG-VERSION-UEN");
  }, 120_000);

  it("a non-string field does not throw TypeError mid-render", async () => {
    // clean() calls v?.trim(); a numeric field threw
    // "TypeError: v?.trim is not a function" and crashed the render.
    const nonString = { v: 1, name: 12345, uen: "VALIDUEN1", address: { nested: true } } as never;
    const text = toText(await renderReferralAgreementPdfFromData(referralData(nonString)));
    // Field by field, not wholesale: the two unusable values fall back to the
    // constants, while the one legitimate string is still honoured — which also
    // shows the reader is not simply discarding the whole snapshot.
    expect(text).toContain(P.name);                       // name 12345 -> constant
    expect(text).toContain(L.address.replace(",", ""));   // address {} -> constant
    expect(text).toContain("VALIDUEN1");                  // valid string kept
    expect(text).not.toContain("12345");
  }, 120_000);
});

// ---------------------------------------------------------------------------
// PROOF 3 — the approval path reads no Company row at all.
// ---------------------------------------------------------------------------
describe("PROOF 3: zero Company reads during an approval re-render (2 approvals)", () => {
  it("neither approveReferral nor renderReferralAgreementPdf touches the Company table", async () => {
    await setEpp(V1);
    const id = await submitReferral("proof3");

    // Spy AFTER submission: submission is the signing moment and is SUPPOSED to
    // read the company row once. What must never happen is a read on the
    // approval path, where a fresh snapshot would overwrite history.
    const spies = (["findUnique", "findFirst", "findMany"] as const).map((m) => vi.spyOn(prisma.company, m));
    try {
      await setEpp(V2);
      const callsAfterEdit = spies.reduce((n, s) => n + s.mock.calls.length, 0);

      await approve(id);
      const afterApprove = spies.reduce((n, s) => n + s.mock.calls.length, 0) - callsAfterEdit;
      expect(afterApprove, "approval read the live Company row").toBe(0);

      // And the standalone re-render, which the approval path delegates to.
      const direct = await renderReferralAgreementPdf(id);
      expect(direct).not.toBeNull();
      const afterRender = spies.reduce((n, s) => n + s.mock.calls.length, 0) - callsAfterEdit - afterApprove;
      expect(afterRender, "the re-render read the live Company row").toBe(0);

      // Control: the spies are live and would have counted a read.
      await prisma.company.findUnique({ where: { id: eppId } });
      expect(spies.reduce((n, s) => n + s.mock.calls.length, 0) - callsAfterEdit).toBe(1);

      // The document still shows V1 — consistent with having read nothing.
      expect(toText(direct!.buffer)).toContain(expectedCompanyStrings(V1).uen);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  }, 180_000);
});
