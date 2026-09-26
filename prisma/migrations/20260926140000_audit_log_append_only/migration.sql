-- Audit reliability (reviews/audit-reliability.md, optional step 6, a SEPARATE
-- commit so it can ship or be dropped on its own): audit_log is append-only.
-- Audit rows can't be changed or removed through the application's data access;
-- INSERT is unaffected. Audit payloads never hold NRIC or other PII values (ids,
-- field names, masked values only), so nothing ever needs to be scrubbed from
-- it — the NRIC retention purge (A-17) doesn't touch it.
--
-- 🔴 LIMIT of this control, stated explicitly because a comment that reads stronger than
-- the guarantee is how someone talks themselves into bypassing it during an incident:
-- this stops the APPLICATION's data access and nothing more. The database owner, or any
-- superuser, can drop or disable this trigger through DDL. There is deliberately NO
-- supported bypass — not `ALTER TABLE ... DISABLE TRIGGER`, not `session_replication_role`
-- — so if audit history appears to need editing, the answer is an investigation, not a
-- superuser session. The compensating control for DDL-level tampering is the OFF-HOST
-- ENCRYPTED BACKUPS, not this trigger.
-- Additive + idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update_delete ON "audit_log";
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON "audit_log";
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
