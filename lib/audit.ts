import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

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
    console.error("[audit] failed to record", params.action, e instanceof Error ? e.message : e);
  }
}
