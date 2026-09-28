// TEST ONLY — makes every commission_ledger insert fail on demand, inside
// real transactions, so a real engine-write failure mid-verify can be proven
// to roll back the whole booking (A-17, the M6/F11 regression case), not a
// mock of the engine. Same local-DB-only guard as the sibling audit fault
// helper in this directory. A BEFORE INSERT trigger raises while armed — a
// single on/off switch, not keyed by transaction id, since verifySale mints
// that id internally and a test can't know it in advance; a test arms it
// immediately before the one call under test and disarms it right after.
import { prisma } from "@/lib/db";

function assertLocalDb(): void {
  if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
    throw new Error("test-ledger-fault: refusing to run outside a test runner");
  }
  let host = "";
  try { host = new URL(process.env.DATABASE_URL ?? "").hostname; } catch { /* empty */ }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error("test-ledger-fault: refusing to install a fault trigger on a non-local database");
  }
}

export async function installLedgerFault(): Promise<void> {
  assertLocalDb();
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS test_ledger_fault (armed boolean PRIMARY KEY DEFAULT true)`);
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_ledger_fault_fn() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM test_ledger_fault) THEN
        RAISE EXCEPTION 'test: commission_ledger write refused';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_ledger_fault_trg ON commission_ledger`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER test_ledger_fault_trg BEFORE INSERT ON commission_ledger FOR EACH ROW EXECUTE FUNCTION test_ledger_fault_fn()`);
}

export async function armLedgerFault(): Promise<void> {
  await prisma.$executeRawUnsafe(`INSERT INTO test_ledger_fault DEFAULT VALUES ON CONFLICT DO NOTHING`);
}

export async function disarmLedgerFault(): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM test_ledger_fault`);
}

export async function removeLedgerFault(): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_ledger_fault_trg ON commission_ledger`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS test_ledger_fault`);
}
