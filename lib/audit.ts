import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "./db";

type Json = Prisma.InputJsonValue;

/**
 * Append an audit-trail entry. Best-effort — never throws, so a logging failure
 * can't roll back the business action it records. Pass `actorUserId` when the
 * caller already has the session to avoid a second auth() lookup.
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
    console.error("[audit] failed to record", params.action, e instanceof Error ? e.message : e);
  }
}
