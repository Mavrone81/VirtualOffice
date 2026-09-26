// Audit reliability (reviews/audit-reliability.md, Tier A "PII as documents"):
// an NRIC-bearing agreement, or a PII export, is recorded BEFORE any byte is
// served — and if that record can't be written, nothing is served (503).
// Real Postgres + real auditTx + real local storage; audit failures via the
// local-only trigger (lib/test-audit-fault.ts). Fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));

import { prisma } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";
import { GET as filesGet } from "@/app/api/files/[...key]/route";
import { GET as exportGet } from "@/app/admin/associates/export/route";
import { GET as docGet } from "@/app/documents/[id]/download/route";

const TAG = "AUDPD-";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN = { user: { associateId: null, id: ADMIN_ID, role: "Admin" } };
let vendorId = "", docId = "", key = "", pfileDocId = "", pfileKey = "", uploadedKey = "", userId = "", pFileId = "";

beforeAll(async () => {
  await installAuditFault();
  vendorId = (await prisma.vendorReferral.create({ data: { vendorName: TAG + "Vendor", vendorSignerName: "Fake Signer" }, select: { id: true } })).id;
  key = `vendors/${vendorId}/agreement.pdf`;
  await putObject(key, Buffer.from("%PDF-1.4\n%fake agreement\n"));
  const docKey = `documents/${vendorId}.pdf`;
  await putObject(docKey, Buffer.from("%PDF-1.4\n%fake signed agreement\n"));
  docId = (await prisma.document.create({ data: { type: "AssociateAgreement", title: TAG + "Signed agreement", fileKey: docKey }, select: { id: true } })).id;
  // A P-File "ID Document" (IC/passport scan) under a key OUTSIDE the fail-safe
  // prefixes — found by the pfile_documents lookup — and an uploaded (legacy)
  // vendor agreement, found by vendor_referrals.agreement_file_key.
  userId = (await prisma.user.create({ data: { email: `${TAG.toLowerCase()}${Date.now()}@example.com`, passwordHash: "x", role: "SalesAssociate" }, select: { id: true } })).id;
  pFileId = (await prisma.pFile.create({ data: { userId }, select: { id: true } })).id;
  pfileKey = `pfile-scans/${vendorId}/ic.pdf`;
  await putObject(pfileKey, Buffer.from("%PDF-1.4\n%fake id scan\n"));
  pfileDocId = (await prisma.pFileDocument.create({ data: { pFileId, docType: "IDDocument", title: "ID", fileKey: pfileKey, filedAt: new Date() }, select: { id: true } })).id;
  uploadedKey = `vendors/${"0f0f0f0f-0000-4000-8000-000000000001"}/uploaded-agreement.pdf`;
  await putObject(uploadedKey, Buffer.from("%PDF-1.4\n%fake uploaded agreement\n"));
  await prisma.vendorReferral.update({ where: { id: vendorId }, data: { agreementFileKey: uploadedKey } });
  who.session = ADMIN;
});
afterEach(clearAuditFaults);
afterAll(async () => {
  await prisma.document.deleteMany({ where: { id: docId } });
  await prisma.pFileDocument.deleteMany({ where: { id: pfileDocId } });
  await prisma.pFile.deleteMany({ where: { id: pFileId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.vendorReferral.deleteMany({ where: { id: vendorId } });
  await removeAuditFault();
});

const getFile = () => filesGet(new Request("http://x/"), { params: Promise.resolve({ key: key.split("/") }) });

describe("NRIC-bearing agreements: no audit, no file", () => {
  it("/api/files: a referral agreement is recorded, then served", async () => {
    const res = await getFile();
    expect(res.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "document.pii_viewed", entityId: vendorId, actorUserId: ADMIN_ID } })).toBe(1);
  });

  it("/api/files: with the audit failing, nothing is served", async () => {
    await failAuditsFor(vendorId);
    expect((await getFile()).status).toBe(503);
  });

  it("/documents/:id/download: a signed Associate Agreement is recorded before streaming; 503 without the record", async () => {
    const ok = await docGet(new Request("http://x/"), { params: Promise.resolve({ id: docId }) });
    expect(ok.status).toBe(200);
    await failAuditsFor(docId);
    expect((await docGet(new Request("http://x/"), { params: Promise.resolve({ id: docId }) })).status).toBe(503);
  });
});

describe("A1: P-File ID documents and uploaded vendor agreements", () => {
  const fetchKey = (k: string) => filesGet(new Request("http://x/"), { params: Promise.resolve({ key: k.split("/") }) });

  it("a P-File ID document (any key) is recorded against the P-File document, then served; 503 without the record", async () => {
    expect((await fetchKey(pfileKey)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "document.pii_viewed", entityType: "PFileDocument", entityId: pfileDocId } })).toBe(1);
    await failAuditsFor(pfileDocId);
    expect((await fetchKey(pfileKey)).status).toBe(503);
  });

  it("an uploaded vendor agreement is recorded against its vendor (not the random key segment); 503 without the record", async () => {
    expect((await fetchKey(uploadedKey)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "document.pii_viewed", entityType: "VendorReferral", entityId: vendorId, afterJson: { path: ["fileKey"], equals: uploadedKey } } })).toBe(1);
    await failAuditsFor(vendorId);
    expect((await fetchKey(uploadedKey)).status).toBe(503);
  });

  it("fail-safe: any other object under associates/ is treated as personal data", async () => {
    const photo = "associates/0a0a0a0a-0000-4000-8000-000000000002/photo.jpg";
    await putObject(photo, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await failAuditsFor("0a0a0a0a-0000-4000-8000-000000000002");
    expect((await fetchKey(photo)).status).toBe(503);
  });
});

describe("sale docket (DevLead: earlier signed ashes PDFs after a re-sign, signatures)", () => {
  const fetchKey = (k: string) => filesGet(new Request("http://x/"), { params: Promise.resolve({ key: k.split("/") }) });
  const SUB = "0b0b0b0b-0000-4000-8000-000000000003";

  it("an old signed agreement PDF (no longer the current agreementPdfKey) is recorded against the sale; 503 without it", async () => {
    const old = `submissions/${SUB}/5e5e5e5e-0000-4000-8000-000000000004.pdf`;
    await putObject(old, Buffer.from("%PDF-1.4\n%fake earlier signed ashes agreement\n"));
    expect((await fetchKey(old)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "document.pii_viewed", entityType: "SalesSubmission", entityId: SUB } })).toBeGreaterThanOrEqual(1);
    await failAuditsFor(SUB);
    expect((await fetchKey(old)).status).toBe(503);
  });

  it("a per-signing signature image is refused without a record", async () => {
    const sig = `submissions/${SUB}/6f6f6f6f-0000-4000-8000-000000000005-signature.png`;
    await putObject(sig, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await failAuditsFor(SUB);
    expect((await fetchKey(sig)).status).toBe(503);
  });
});

describe("PII export", () => {
  it("the contacts CSV is recorded before any row is written; 503 without the record", async () => {
    expect((await exportGet()).status).toBe(200);
    await failAuditsFor("pii.exported");
    expect((await exportGet()).status).toBe(503);
  });
});
