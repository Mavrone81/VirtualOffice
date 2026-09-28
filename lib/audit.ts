import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { recordAuditFailure } from "./audit-status";

type Json = Prisma.InputJsonValue;

/**
 * Append an audit-trail entry. Best-effort — never throws, so a logging failure
 * can't roll back the business action it records. Pass `actorUserId` (`null`
 * for a system/background actor) when the caller already knows it, to avoid a
 * second auth() lookup — and, for a backfill/CLI script run outside a request
 * (the SEC-12 tools image, F1/R1), because `@/auth` pulls in the whole
 * NextAuth/session stack, which isn't in that image and shouldn't need to be.
 * The import below is dynamic and only reached when `actorUserId` is omitted,
 * so a caller that always passes one (explicit `null` included) never
 * triggers it.
 */
export async function logAudit(params: {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Json;
  after?: Json;
  actorUserId?: string | null;
}): Promise<void> {
  try {
    let actor = params.actorUserId;
    if (actor === undefined) {
      const { auth } = await import("@/auth");
      const session = await auth();
      actor = session?.user?.id ?? null;
    }
    await prisma.auditLog.create({
      data: {
        actorUserId: actor ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        beforeJson: params.before,
        afterJson: params.after,
      },
    });
  } catch (e) {
    // Tier B (reviews/audit-reliability.md): best-effort, but never silent. Logs a
    // fixed tag with the action, entity type and error class/code only — never the
    // error message or the payload.
    recordAuditFailure();
    const code = (e as { code?: unknown })?.code;
    console.error(`[audit-failed] ${params.action} ${params.entityType} ${e instanceof Error ? e.name : "error"}${code ? ` ${String(code)}` : ""}`);
  }
}

/**
 * Tier A (reviews/audit-reliability.md): the audit is part of the action. Call it
 * as the LAST statement inside the action's own `prisma.$transaction`, with that
 * transaction's client. It THROWS on failure, so the whole action rolls back —
 * money, payee, security and PII actions never happen unrecorded. The actor is
 * required (`null` = system/script); there's no session lookup here. Never put a
 * PII value in `before`/`after`: ids, field names and masked values only.
 */
export class AuditWriteError extends Error {
  constructor(action: string, cause: unknown) {
    // The action name only — never the payload or the underlying message.
    super(`audit write failed for ${action}; the action was not saved`, { cause });
    this.name = "AuditWriteError";
  }
}

/**
 * Audit-before-reveal (reviews/audit-reliability.md, Tier A): every PII read is
 * recorded BEFORE the value is decrypted/returned, and if that record can't be
 * written, nothing is revealed — this is thrown instead. Callers map it to a
 * "not available right now" answer (never a plaintext fallback).
 */
export class PiiAuditUnavailableError extends Error {
  constructor(cause: unknown) {
    super("PII access could not be recorded in the audit trail; nothing was revealed", { cause });
    this.name = "PiiAuditUnavailableError";
  }
}

export async function auditTx(
  db: Prisma.TransactionClient,
  entry: { action: string; entityType: string; entityId?: string | null; before?: Json; after?: Json; actorUserId: string | null },
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        beforeJson: entry.before,
        afterJson: entry.after,
      },
    });
  } catch (e) {
    throw new AuditWriteError(entry.action, e);
  }
}
