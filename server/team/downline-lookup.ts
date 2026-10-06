import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { downlineLookupScope, downlineIds } from "@/lib/rbac";
import { resolveTargetsFor } from "@/server/quota/resolve";
import { inPeriod } from "@/lib/quota";
import { sum } from "@/lib/money";
import { SubmissionStatus } from "@prisma/client";
import type { AppRole } from "@prisma/client";

export type Period = "month" | "year";

function periodRange(period: Period, now: Date): { start: Date; end: Date } {
  if (period === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear() + 1, 0, 1) };
}

/**
 * Search box, ITEM 7. Matches like app/admin/search (code / name / email /
 * business name), intersected with {@link downlineLookupScope} — the SAME
 * choke point the subject lookup below uses. An out-of-scope associate must
 * not even APPEAR here: a name, code and designation reaching a viewer who
 * may not open that person is a disclosure on its own, independent of
 * whatever a click-through would later refuse.
 */
export async function searchDownlineCandidates(
  viewer: { id: string; role: AppRole },
  query: string,
): Promise<{ id: string; associateCode: string; fullName: string; designation: string }[]> {
  const q = query.trim();
  if (!q) return [];
  const scope = await downlineLookupScope(viewer);
  if (scope !== null && scope.length === 0) return [];
  const insensitive = { contains: q, mode: "insensitive" as const };
  return prisma.associate.findMany({
    where: {
      AND: [
        { OR: [{ associateCode: insensitive }, { fullName: insensitive }, { email: insensitive }, { businessName: insensitive }] },
        ...(scope === null ? [] : [{ id: { in: scope } }]),
      ],
    },
    select: { id: true, associateCode: true, fullName: true, designation: true },
    orderBy: { associateCode: "asc" },
    take: 12,
  });
}

/**
 * BFS level, computed in application code from direct_upline_id edges among
 * members ALREADY KNOWN to be in the subject's tree (downlineIds already
 * proved that) — deliberately NOT a level counter added to that CTE. The
 * CTE's cycle-safety today rests on UNION deduping by the bare `id` it
 * selects; a row that also carries a level would no longer dedupe against
 * an earlier visit to the same id at a different level, which would turn a
 * data-integrity cycle into infinite recursion instead of the no-op it is
 * today. BFS with a size-bounded frontier has no such failure mode.
 */
function assignLevels(rootId: string, members: { id: string; directUplineId: string | null }[]): Map<string, number> {
  const byUpline = new Map<string, string[]>();
  for (const m of members) {
    if (m.directUplineId) byUpline.set(m.directUplineId, [...(byUpline.get(m.directUplineId) ?? []), m.id]);
  }
  const levels = new Map<string, number>([[rootId, 0]]);
  let frontier = [rootId];
  const safetyBound = members.length + 1; // cannot need more hops than there are members
  for (let depth = 0; depth < safetyBound && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const childId of byUpline.get(id) ?? []) {
        if (!levels.has(childId)) { levels.set(childId, depth + 1); next.push(childId); }
      }
    }
    frontier = next;
  }
  return levels;
}

export type DownlineLookupRow = {
  id: string; associateCode: string; fullName: string; designation: string; level: number;
  uplineCode: string | null; closed: string; pending: string; rejected: string; commission: string;
  target: { amount: string; source: "individual" | "team" } | null; status: string;
};
export type DownlineLookupResult = {
  subject: { id: string; associateCode: string; fullName: string; designation: string; teamName: string | null; closed: string; pending: string; rejected: string; commission: string; target: { amount: string; source: "individual" | "team" } | null };
  rows: DownlineLookupRow[];
};

/**
 * ITEM 7's subject query. `subjectId` arrives in a request parameter and is
 * NEVER trusted directly: {@link downlineLookupScope} decides, server-side,
 * whether this viewer may open it, before anything about the subject is
 * read. A refusal and "this id does not exist" return the IDENTICAL `null`
 * — the one disclosure this function must not make is which one happened.
 */
export async function getDownlineLookup(
  viewer: { id: string; role: AppRole },
  subjectId: string,
  period: Period,
  now: Date = new Date(),
): Promise<DownlineLookupResult | null> {
  const scope = await downlineLookupScope(viewer);
  if (scope !== null && !scope.includes(subjectId)) return null; // refused -- same shape as not-found, by design

  const subject = await prisma.associate.findUnique({ where: { id: subjectId }, select: { id: true, associateCode: true, fullName: true, designation: true, teamName: true } });
  if (!subject) return null; // genuinely absent -- deliberately identical to the refusal above

  const tree = await downlineIds(subjectId); // self-inclusive
  const downlineOnly = tree.filter((id) => id !== subjectId);
  const allIds = tree;

  const { start, end } = periodRange(period, now);
  const periodKey = period === "month" ? format(now, "yyyy-MM") : format(now, "yyyy");

  const [members, submissions, ledgerRows, targets] = await Promise.all([
    prisma.associate.findMany({ where: { id: { in: downlineOnly } }, select: { id: true, associateCode: true, fullName: true, designation: true, directUplineId: true, associateStatus: true }, orderBy: { associateCode: "asc" } }),
    prisma.salesSubmission.findMany({ where: { closingAssociateId: { in: allIds }, salesDate: { gte: start, lt: end } }, select: { closingAssociateId: true, saleAmount: true, status: true } }),
    prisma.commissionLedger.findMany({ where: { associateId: { in: allIds } }, select: { associateId: true, amount: true, payoutMonth: true } }),
    resolveTargetsFor(allIds, now),
  ]);

  const ledgerInPeriod = ledgerRows.filter((l) => inPeriod(l.payoutMonth, periodKey));
  const levels = assignLevels(subjectId, [{ id: subjectId, directUplineId: null }, ...members.map((m) => ({ id: m.id, directUplineId: m.directUplineId }))]);
  const uplineCodeOf = new Map(members.map((m) => [m.id, m.directUplineId]));
  const codeById = new Map(members.map((m) => [m.id, m.associateCode] as const));
  codeById.set(subject.id, subject.associateCode);

  function moneyFor(id: string) {
    const subs = submissions.filter((s) => s.closingAssociateId === id);
    const closed = sum(subs.filter((s) => s.status === SubmissionStatus.Verified).map((s) => s.saleAmount));
    const pending = sum(subs.filter((s) => s.status === SubmissionStatus.Submitted || s.status === SubmissionStatus.QuotationApproved).map((s) => s.saleAmount));
    const rejected = sum(subs.filter((s) => s.status === SubmissionStatus.Rejected).map((s) => s.saleAmount));
    const commission = sum(ledgerInPeriod.filter((l) => l.associateId === id).map((l) => l.amount));
    const t = period === "month" ? targets.get(id)?.month : targets.get(id)?.year;
    return {
      closed: closed.toFixed(2), pending: pending.toFixed(2), rejected: rejected.toFixed(2), commission: commission.toFixed(2),
      target: t ? { amount: t.amount, source: t.source } : null,
    };
  }

  const subjectMoney = moneyFor(subjectId);
  const rows: DownlineLookupRow[] = members.map((m) => {
    const money = moneyFor(m.id);
    const uplineId = uplineCodeOf.get(m.id);
    return {
      id: m.id, associateCode: m.associateCode, fullName: m.fullName, designation: m.designation,
      level: levels.get(m.id) ?? 1, uplineCode: uplineId ? codeById.get(uplineId) ?? null : null,
      status: m.associateStatus, ...money,
    };
  }).sort((a, b) => a.level - b.level || a.associateCode.localeCompare(b.associateCode));

  return {
    subject: { ...subject, ...subjectMoney },
    rows,
  };
}
