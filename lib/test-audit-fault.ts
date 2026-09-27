// TEST ONLY — makes audit_log inserts fail on demand, inside real transactions,
// so Tier-A rollback and audit-before-reveal can be proven against Postgres
// (reviews/audit-reliability.md). A BEFORE INSERT trigger raises when the new
// row's entity_id OR action is listed in test_audit_fault. Refuses to touch
// anything but a local database.
import { prisma } from "@/lib/db";

function assertLocalDb(): void {
  // Two independent conditions (DevLead): requires a test runner in addition to a
  // local database host.
  if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
    throw new Error("test-audit-fault: refusing to run outside a test runner");
  }
  let host = "";
  try { host = new URL(process.env.DATABASE_URL ?? "").hostname; } catch { /* empty */ }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error("test-audit-fault: refusing to install a fault trigger on a non-local database");
  }
}

export async function installAuditFault(): Promise<void> {
  assertLocalDb();
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS test_audit_fault (match_key text PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_audit_fault_fn() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM test_audit_fault WHERE match_key = NEW.entity_id OR match_key = NEW.action) THEN
        RAISE EXCEPTION 'test: audit write refused';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_audit_fault_trg ON audit_log`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER test_audit_fault_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_audit_fault_fn()`);
}

/** Make every audit insert whose entity_id or action equals one of `keys` fail. */
export async function failAuditsFor(...keys: string[]): Promise<void> {
  for (const k of keys) await prisma.$executeRawUnsafe(`INSERT INTO test_audit_fault (match_key) VALUES ($1) ON CONFLICT DO NOTHING`, k);
}

export async function clearAuditFaults(): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM test_audit_fault`);
}

export async function removeAuditFault(): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_audit_fault_trg ON audit_log`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS test_audit_fault`);
}
