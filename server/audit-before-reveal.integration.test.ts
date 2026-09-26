// Audit reliability (reviews/audit-reliability.md), Tier A for PII: every reveal
// is recorded BEFORE the value leaves, and if that record can't be written,
// nothing is revealed. Also the bank file: its batch stamp and audit commit
// together, and an account decrypt whose audit fails means no file.
// Real throwaway Postgres; audit failures are injected with a local-only trigger
// (lib/test-audit-fault.ts). Fake data only, cleaned up.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const who: { session: unknown } = { session: null };
vi.mock("@/auth", () => ({ auth: async () => who.session }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { encryptPII } from "@/lib/crypto";
import { AuditWriteError } from "@/lib/audit";
import { installAuditFault, failAuditsFor, clearAuditFaults, removeAuditFault } from "@/lib/test-audit-fault";
import { decryptPiiAudited, readNric, PiiAuditUnavailableError } from "./pii";
import { revealAssociatePii } from "./associates/actions";
import { buildBankFileCsv } from "./payouts/bankfile";
import { applyNricEncryptBackfill } from "./pii-nric-backfill";

const TAG = "AUDREV-";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN = { user: { associateId: null, id: ADMIN_ID, role: "Admin" } };
let assocId = "";

beforeAll(async () => {
  await installAuditFault();
  assocId = (await prisma.associate.create({
    data: {
      associateCode: TAG + "A1", fullName: TAG + "Fake Person", designation: "SalesAssociate", approvalStatus: "Approved",
      associateStatus: "Active", nric: encryptPII("S0000099A"), paymentMethod: "BankTransfer",
      bankName: "Fake Bank", bankAccountNumber: encryptPII("000-000000-0"),
    },
    select: { id: true },
  })).id;
});
afterEach(clearAuditFaults);
afterAll(async () => {
  await prisma.monthlyPayout.deleteMany({ where: { associateId: assocId } });
  await prisma.bankFileBatch.deleteMany({ where: { payoutMonth: { startsWith: "2197-" } } });
  await prisma.associate.deleteMany({ where: { id: assocId } });
  await removeAuditFault();
});

const accessAudits = () => prisma.auditLog.count({ where: { entityId: assocId, action: { in: ["decrypt_pii", "pii.plaintext_read"] } } });

describe("audit-before-reveal", () => {
  it("decryptPiiAudited: audit first; a failed audit throws and reveals nothing", async () => {
    const a = await prisma.associate.findUniqueOrThrow({ where: { id: assocId } });
    const before = await accessAudits();
    expect(await decryptPiiAudited({ blob: a.nric, field: "nric", subjectType: "Associate", subjectId: assocId, actorUserId: ADMIN_ID })).toBe("S0000099A");
    expect(await accessAudits()).toBe(before + 1);

    await failAuditsFor(assocId);
    await expect(decryptPiiAudited({ blob: a.nric, field: "nric", subjectType: "Associate", subjectId: assocId, actorUserId: ADMIN_ID }))
      .rejects.toBeInstanceOf(PiiAuditUnavailableError);
    expect(await accessAudits()).toBe(before + 1); // nothing recorded, nothing returned
  });

  it("revealAssociatePii: a failed audit is a clean 'auditUnavailable', never the value", async () => {
    who.session = ADMIN;
    expect(await revealAssociatePii(assocId, "bankAccount")).toEqual({ ok: true, value: "000-000000-0" });
    await failAuditsFor(assocId);
    expect(await revealAssociatePii(assocId, "bankAccount")).toEqual({ ok: false, error: "auditUnavailable" });
  });

  it("readNric: both the v1 and the legacy-plaintext branch refuse to return without an audit", async () => {
    await failAuditsFor(assocId);
    await expect(readNric({ blob: encryptPII("S0000098B"), field: "applicant1Nric", subjectType: "PetsAshesAgreement", subjectId: assocId, actorUserId: null }))
      .rejects.toBeInstanceOf(PiiAuditUnavailableError);
    await expect(readNric({ blob: "S1234567A", field: "applicant1Nric", subjectType: "PetsAshesAgreement", subjectId: assocId, actorUserId: null }))
      .rejects.toBeInstanceOf(PiiAuditUnavailableError);
  });
});

describe("bank file (Tier A)", () => {
  async function approvedPayout(month: string) {
    return prisma.monthlyPayout.create({
      data: {
        payoutMonth: month, associateId: assocId, seq: 0, associateName: TAG + "Fake Person", designation: "SalesAssociate",
        paymentMethod: "BankTransfer", bankName: "Fake Bank", bankAccountNumber: encryptPII("000-000000-0"),
        totalPayable: "100.00", payoutStatus: "Approved",
      },
    });
  }

  it("the batch stamp rolls back when its own audit can't be written", async () => {
    const p = await approvedPayout("2197-01");
    await failAuditsFor("payout.bankfile_generated");
    await expect(buildBankFileCsv("2197-01", ADMIN_ID)).rejects.toBeInstanceOf(AuditWriteError);
    const after = await prisma.monthlyPayout.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.bankFileBatchId).toBeNull(); // not exported — it can be generated again
    expect(await prisma.bankFileBatch.count({ where: { payoutMonth: "2197-01" } })).toBe(0);
  });

  it("no file when an account decrypt can't be audited", async () => {
    await approvedPayout("2197-02");
    await failAuditsFor(assocId); // the decrypt_pii audit for this associate
    await expect(buildBankFileCsv("2197-02", ADMIN_ID)).rejects.toBeInstanceOf(PiiAuditUnavailableError);
  });

  it("a re-download is audited before anything is built", async () => {
    await clearAuditFaults();
    await approvedPayout("2197-03");
    const first = await buildBankFileCsv("2197-03", ADMIN_ID);
    expect(first.batchId).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "payout.bankfile_generated", entityId: first.batchId! } })).toBe(1);
    await failAuditsFor("payout.bankfile_redownloaded");
    await expect(buildBankFileCsv("2197-03", ADMIN_ID, { batchId: first.batchId! })).rejects.toBeInstanceOf(AuditWriteError);
  });
});

describe("SEC-12 backfill (Tier A per row)", () => {
  it("a row whose audit can't be written stays plaintext; a re-run encrypts and records it", async () => {
    const v = await prisma.vendorReferral.create({ data: { vendorName: TAG + "V", vendorSignerName: "Fake", vendorSignerNric: "S0000096D" }, select: { id: true } });
    await failAuditsFor(v.id);
    await expect(applyNricEncryptBackfill(prisma, null)).rejects.toBeInstanceOf(AuditWriteError);
    expect((await prisma.vendorReferral.findUniqueOrThrow({ where: { id: v.id } })).vendorSignerNric).toBe("S0000096D");

    await clearAuditFaults();
    await applyNricEncryptBackfill(prisma, null);
    expect((await prisma.vendorReferral.findUniqueOrThrow({ where: { id: v.id } })).vendorSignerNric?.startsWith("v1:")).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "pii.nric_encrypted", entityId: v.id } })).toBe(1);
    await prisma.vendorReferral.delete({ where: { id: v.id } });
  });
});
