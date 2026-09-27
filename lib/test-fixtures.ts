/** A minimal, magic-byte-valid fake PDF for tests exercising SEC-11 upload
 * checks (B-7's payment acknowledgement, uploadSignedInvoice, etc.) — never
 * used outside test files. */
export function fakePdfFile(name = "ack.pdf"): File {
  const bytes = new TextEncoder().encode("%PDF-1.4\n%fake test pdf\n");
  return new File([bytes], name, { type: "application/pdf" });
}

type AuditEntry = { action: string; entityType?: string; entityId?: string | null; before?: unknown; after?: unknown; actorUserId?: string | null };
type MockFn = { mock: { calls: unknown[][] } };

/** Audit reliability: every audit entry a test recorded, from BOTH mocked writers —
 * Tier A `auditTx(db, entry)` (arg 2) first, then best-effort `logAudit(entry)`
 * (arg 1). Pass the mocked functions from "@/lib/audit". Test-only. */
export function auditedEntries(logAudit: unknown, auditTx: unknown): AuditEntry[] {
  const tx = (auditTx as MockFn).mock.calls.map((c) => c[1] as AuditEntry);
  const best = (logAudit as MockFn).mock.calls.map((c) => c[0] as AuditEntry);
  return [...tx, ...best];
}
