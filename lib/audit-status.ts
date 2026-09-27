// In-process Tier-B audit failure counter (reviews/audit-reliability.md). Kept in
// its own dependency-free module so /api/health can read it without loading
// Prisma or the env schema (that route must never touch the database).
let failures = 0;

export function recordAuditFailure(): void {
  failures++;
}

/** False once any best-effort audit write has failed in this process (since boot). */
export function auditOk(): boolean {
  return failures === 0;
}
