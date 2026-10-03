import { prisma } from "@/lib/db";
import { periodKeys, resolveTarget, type ResolvedTarget } from "@/lib/quota";

export type ResolvedTargets = { month: ResolvedTarget | null; year: ResolvedTarget | null };

/**
 * Monthly + yearly target for each associate, individual override first, then
 * team target, else null (all via resolveTarget). Every consumer calls this;
 * none re-implements the order. Three queries regardless of list size. Only
 * active teams count; an associate is "in" a team as member or director,
 * matching teamScopeIds.
 */
export async function resolveTargetsFor(associateIds: string[], now: Date = new Date()): Promise<Map<string, ResolvedTargets>> {
  const out = new Map<string, ResolvedTargets>();
  if (associateIds.length === 0) return out;
  const { month, year } = periodKeys(now);

  const [overrides, teams] = await Promise.all([
    prisma.salesQuota.findMany({
      where: { associateId: { in: associateIds }, month: { in: [month, year] } },
      select: { associateId: true, month: true, amount: true },
    }),
    prisma.team.findMany({
      where: { active: true, OR: [{ directorId: { in: associateIds } }, { members: { some: { associateId: { in: associateIds } } } }] },
      select: {
        directorId: true,
        members: { where: { associateId: { in: associateIds } }, select: { associateId: true } },
        quotas: {
          where: { OR: [{ periodType: "Monthly", period: month }, { periodType: "Yearly", period: year }] },
          select: { periodType: true, amount: true },
        },
      },
    }),
  ]);

  for (const id of associateIds) {
    const own = (period: string) => overrides.find((q) => q.associateId === id && q.month === period)?.amount;
    const mine = teams.filter((t) => t.directorId === id || t.members.some((m) => m.associateId === id));
    const teamAmts = (type: "Monthly" | "Yearly") =>
      mine.flatMap((t) => t.quotas.filter((q) => q.periodType === type).map((q) => q.amount));
    out.set(id, {
      month: resolveTarget(own(month), teamAmts("Monthly")),
      year: resolveTarget(own(year), teamAmts("Yearly")),
    });
  }
  return out;
}
