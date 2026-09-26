// Audit reliability (reviews/audit-reliability.md, step 6): audit_log is
// append-only at the database level (migration 20260926140000_audit_log_append_only).
// Inserts work; UPDATE, DELETE and TRUNCATE are refused, whichever client asks.
// Real throwaway Postgres; fake data only.
//
// 🔴 DO NOT "FIX" THE MUTATION CALLS IN THIS FILE — THEY ARE THE TEST.
// The update / deleteMany / raw TRUNCATE below are DELIBERATE: each is wrapped in
// `expect(...).rejects.toThrow(/append-only/)` and asserts that the trigger REFUSES it.
// This file is the automated proof of a control that makes a table permanently
// append-only; a manual run on a throwaway DB is evidence, this is the regression test.
//
// There is a standing rule to sweep every open branch for audit_log mutations and remove
// them (a teardown that deletes audit rows breaks once the trigger is live). That sweep
// will match the lines below. 🔴 THIS FILE IS THE ONE EXCEPTION — skip it.
//
// 🔴 Why a wrong "fix" here is silent, which is the real hazard: delete those three
// assertions and the test STILL PASSES. What remains (insert a row, read it back) is
// green with or without the trigger, so the file keeps reporting success while proving
// nothing at all — and the next person to change the migration gets no warning.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { auditTx } from "@/lib/audit";

const ID = "aaaaaaaa-0000-4000-8000-00000000a0a0";

describe("audit_log is append-only", () => {
  it("inserts, but refuses UPDATE, DELETE and TRUNCATE", async () => {
    await auditTx(prisma, { action: "test.append_only", entityType: "Test", entityId: ID, actorUserId: null });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "test.append_only", entityId: ID } });

    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "rewritten" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);

    const still = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(still.action).toBe("test.append_only");
  });
});
