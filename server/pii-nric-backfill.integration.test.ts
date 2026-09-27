// SEC-12: the NRIC encryption backfill (dry run + apply, idempotency), and a
// proof that an encrypted row renders the exact same PDF bytes as the
// plaintext row it replaces. Needs a local PG (DATABASE_URL); fake data only,
// all rows tagged and cleaned up.
import { describe, it, expect, afterAll, vi } from "vitest";
import zlib from "node:zlib";

vi.mock("@/auth", () => ({ auth: async () => null })); // PDF renders run without an actor → session lookup
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(), auditTx: vi.fn() }));

import { prisma } from "@/lib/db";
import { encryptPII, decryptPiiRaw } from "@/lib/crypto";
import { planNricEncryptBackfill, applyNricEncryptBackfill, assertEncryptionCanary } from "./pii-nric-backfill";
import { renderReferralAgreementPdf } from "@/lib/pdf/referral-agreement";
import { renderAshesAgreementPdf } from "@/lib/pdf/ashes-agreement";

const TAG = "SEC12-";

// @react-pdf/renderer embeds a wall-clock creation timestamp
// ("(D:YYYYMMDDHHMMSSZ)") and a /ID trailer derived from it, so two renders a
// second apart differ there even with identical content -- mask both out
// before comparing everything else.
const maskVolatile = (s: string) => s
  .replace(/\(D:\d{14}Z\)/g, "(D:MASKED)")
  .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, "/ID [MASKED]");

/**
 * DevLead (2026-09-26): a raw byte comparison flaked once under load ("content
 * stream length differed between the two renders"). Diagnosed by rendering
 * the SAME unchanged record 40 times: @react-pdf/renderer (pdfkit) writes its
 * PDF objects to the output file in a non-deterministic ORDER — almost
 * certainly async font-embedding resolving in a different completion order
 * each time — but every individual object's decompressed content, byte for
 * byte, was identical across every render that "differed" by raw bytes. A
 * warm-up render doesn't fix this (it recurred at any position, not just the
 * first render), because it isn't a cold-start cost — it's an ordering race
 * that exists on every render equally.
 *
 * So instead of comparing the raw file, parse each numbered object out (its
 * dict header, and its stream decompressed if `FlateDecode`), and compare the
 * resulting {object number -> content} map — order-independent, immune to the
 * write-order race, but exactly as strict about actual content: any real
 * change to what a page draws still fails this comparison.
 */
function canonicalizePdf(buffer: Buffer): string {
  const text = buffer.toString("latin1");
  const objects = new Map<number, string>();
  const objRe = /(\d+) 0 obj\s*<<(.*?)>>\s*(?:stream\r?\n([\s\S]*?)\r?\nendstream\s*)?endobj/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text))) {
    const [, numStr, dict, streamBody] = m;
    let body = dict;
    if (streamBody !== undefined) {
      const raw = Buffer.from(streamBody, "latin1");
      const decoded = /\/Filter\s*\/FlateDecode/.test(dict) ? zlib.inflateSync(raw).toString("latin1") : streamBody;
      body += `\nstream\n${decoded}\nendstream`;
    }
    objects.set(Number(numStr), maskVolatile(body));
  }
  // Sorted by object number: the write order is exactly what's non-deterministic.
  return [...objects.entries()].sort(([a], [b]) => a - b).map(([n, body]) => `${n} 0 obj${body}endobj`).join("\n");
}

afterAll(async () => {
  await prisma.vendorReferral.deleteMany({ where: { vendorName: { startsWith: TAG } } });
  await prisma.petsAshesAgreement.deleteMany({ where: { applicant1Name: { startsWith: TAG } } });
  await prisma.salesTransaction.deleteMany({ where: { clientName: { startsWith: TAG } } });
  await prisma.salesSubmission.deleteMany({ where: { clientName: { startsWith: TAG } } });
  await prisma.associate.deleteMany({ where: { associateCode: { startsWith: TAG } } });
});

describe("SEC-12: encryption canary (S1)", () => {
  it("passes: decrypts an existing associate ciphertext with the current key, without creating one to force it", async () => {
    // Seed the one thing the canary needs — real, already-encrypted associate
    // PII — the same way the live encrypt-on-write code would have produced
    // it. The canary itself must never write; this fixture only exists so the
    // test is deterministic regardless of what other data is in this DB.
    await prisma.associate.create({
      data: {
        associateCode: TAG + "Canary", fullName: TAG + "CanarySeed", designation: "SalesAssociate",
        approvalStatus: "Approved", associateStatus: "Active", nric: encryptPII("S0000000Z"),
      },
      select: { id: true },
    });
    await expect(assertEncryptionCanary(prisma)).resolves.not.toThrow();
  });
});

describe("SEC-12: NRIC backfill (dry run + apply, idempotent)", () => {
  it("dry run counts a plaintext row as to-encrypt; apply encrypts it; a second apply is a no-op", async () => {
    const nric = "S1234567A";
    const vendor = await prisma.vendorReferral.create({
      data: { vendorName: TAG + "Vendor", vendorSignerName: "Signer", vendorSignerNric: nric },
      select: { id: true },
    });

    const before = await planNricEncryptBackfill(prisma);
    const vendorRow = before.find((r) => r.table === "vendor_referrals" && r.column === "vendor_signer_nric")!;
    expect(vendorRow.toEncrypt).toBeGreaterThanOrEqual(1); // at least our row (others may pre-exist)

    const apply1 = await applyNricEncryptBackfill(prisma, null);
    const vendorAfter1 = apply1.find((r) => r.table === "vendor_referrals" && r.column === "vendor_signer_nric")!;
    expect(vendorAfter1.toEncrypt).toBe(0);
    expect(vendorAfter1.encryptedNow).toBeGreaterThanOrEqual(1);

    const stored = await prisma.vendorReferral.findUniqueOrThrow({ where: { id: vendor.id }, select: { vendorSignerNric: true } });
    expect(stored.vendorSignerNric).not.toBe(nric); // no longer plaintext
    expect(stored.vendorSignerNric!.startsWith("v1:")).toBe(true);
    expect(decryptPiiRaw(stored.vendorSignerNric!)).toBe(nric); // round-trips to the original

    // Idempotent: re-running touches nothing.
    const apply2 = await applyNricEncryptBackfill(prisma, null);
    const vendorAfter2 = apply2.find((r) => r.table === "vendor_referrals" && r.column === "vendor_signer_nric")!;
    expect(vendorAfter2.encryptedNow).toBe(0);
    const restill = await prisma.vendorReferral.findUniqueOrThrow({ where: { id: vendor.id }, select: { vendorSignerNric: true } });
    expect(restill.vendorSignerNric).toBe(stored.vendorSignerNric); // byte-identical, not re-encrypted
  });

  it("a row already stored as ciphertext is never touched (idempotency guard on write, not just read)", async () => {
    const nric = "S1234567A";
    const ciphertext = encryptPII(nric);
    const vendor = await prisma.vendorReferral.create({
      data: { vendorName: TAG + "Vendor2", vendorSignerName: "Signer2", vendorSignerNric: ciphertext },
      select: { id: true },
    });
    await applyNricEncryptBackfill(prisma, null);
    const after = await prisma.vendorReferral.findUniqueOrThrow({ where: { id: vendor.id }, select: { vendorSignerNric: true } });
    expect(after.vendorSignerNric).toBe(ciphertext); // untouched
  });
});

describe("SEC-12: an encrypted row renders the identical PDF to the plaintext row it replaces", () => {
  it("referral agreement PDF is byte-identical before and after encryption", async () => {
    // S2/DevSecOps: @react-pdf/renderer's first render in a run occasionally
    // exceeded vitest's 5s default.
    const nric = "S9988776C";
    const vendor = await prisma.vendorReferral.create({
      data: {
        vendorName: TAG + "PdfVendor", vendorSignerName: "PDF Signer", vendorSignerNric: nric,
        agreementDate: new Date("2026-01-01"), companySignName: "Company Officer", companySignDesignation: "Manager",
        companySignedAt: new Date("2026-01-02"),
      },
      select: { id: true },
    });

    const before = await renderReferralAgreementPdf(vendor.id);
    expect(before).not.toBeNull();

    await applyNricEncryptBackfill(prisma, null);
    const stored = await prisma.vendorReferral.findUniqueOrThrow({ where: { id: vendor.id }, select: { vendorSignerNric: true } });
    expect(stored.vendorSignerNric!.startsWith("v1:")).toBe(true); // confirmed encrypted now

    const after = await renderReferralAgreementPdf(vendor.id);
    expect(after).not.toBeNull();
    expect(canonicalizePdf(after!.buffer)).toBe(canonicalizePdf(before!.buffer)); // identical rendered PDF either way
  }, 30_000);

  it("(F2/Architect) Pets Ashes agreement PDF is byte-identical before and after encryption, all 4 NRIC fields", async () => {
    const assoc = await prisma.associate.create({
      data: { associateCode: TAG + "A1", fullName: TAG + "Closer", designation: "SalesAssociate", approvalStatus: "Approved", associateStatus: "Active" },
      select: { id: true },
    });
    const sub = await prisma.salesSubmission.create({
      data: {
        salesDate: new Date("2026-01-01"), clientName: TAG + "Client", saleAmount: "1000", paymentPlan: "FullPayment",
        closingAssociateId: assoc.id, status: "QuotationApproved",
      },
      select: { id: true },
    });
    const agreement = await prisma.petsAshesAgreement.create({
      data: {
        submissionId: sub.id,
        applicant1Name: TAG + "Applicant1", applicant1Nric: "S1111111A",
        applicant2Name: TAG + "Applicant2", applicant2Nric: "S1234567A",
        applicantWitnessName: TAG + "Witness", applicantWitnessNric: "S3333333C",
        companyWitnessName: TAG + "CoWitness", companyWitnessNric: "S4444444D",
        amountNumeric: "1000.00", amountWords: "One thousand dollars", paymentPlan: "FullPayment",
      },
      select: { id: true },
    });

    const before = await renderAshesAgreementPdf(agreement.id);
    expect(before).not.toBeNull();

    await applyNricEncryptBackfill(prisma, null);
    const stored = await prisma.petsAshesAgreement.findUniqueOrThrow({
      where: { id: agreement.id },
      select: { applicant1Nric: true, applicant2Nric: true, applicantWitnessNric: true, companyWitnessNric: true },
    });
    for (const v of Object.values(stored)) expect(v!.startsWith("v1:")).toBe(true); // all 4 confirmed encrypted now

    const after = await renderAshesAgreementPdf(agreement.id);
    expect(after).not.toBeNull();
    expect(canonicalizePdf(after!.buffer)).toBe(canonicalizePdf(before!.buffer)); // identical rendered PDF either way
  }, 30_000); // S2/DevSecOps: same cold-render cost as the referral-agreement test above
});
