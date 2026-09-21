import { Designation, LedgerLineType, LedgerStatus } from "@prisma/client";
import { D, round2, ZERO } from "@/lib/money";
import type { Prisma } from "@prisma/client";

/**
 * Recruitment Dashboard + Downline Performance (associate-portal changes,
 * Sep 2026 — A8/A10). Pure helpers so the tab/filter rules are testable.
 *
 * Tabs:  all      = everyone below me in the upline tree
 *        direct   = whose direct upline is me
 *        downline = below me but NOT my direct recruits
 * Filter: `mgr` narrows any tab to one downline manager's own tree (their
 *         recruits, their recruits' recruits, …), excluding the manager.
 */
export type RecruitTab = "all" | "direct" | "downline";
export const RECRUIT_TABS: RecruitTab[] = ["all", "direct", "downline"];
export const parseTab = (v: string | undefined): RecruitTab =>
  RECRUIT_TABS.includes(v as RecruitTab) ? (v as RecruitTab) : "all";

type Node = { id: string; directUplineId: string | null; designation: Designation };

/** Everyone strictly below `root` in the tree formed by `rows`. */
export function descendants<T extends Node>(rows: T[], root: string): T[] {
  const byUpline = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.directUplineId) continue;
    const list = byUpline.get(r.directUplineId) ?? [];
    list.push(r);
    byUpline.set(r.directUplineId, list);
  }
  const out: T[] = [];
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of byUpline.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

export function selectRecruits<T extends Node>(rows: T[], me: string, tab: RecruitTab, mgr?: string | null): T[] {
  let list = descendants(rows, me);
  if (tab === "direct") list = list.filter((r) => r.directUplineId === me);
  if (tab === "downline") list = list.filter((r) => r.directUplineId !== me);
  if (mgr && list.length) {
    const underMgr = new Set(descendants(rows, mgr).map((r) => r.id));
    list = list.filter((r) => underMgr.has(r.id));
  }
  return list;
}

/** Managers below me who have recruits of their own — the filter's options. */
export function managerOptions<T extends Node & { associateCode: string; fullName: string }>(rows: T[], me: string): T[] {
  const mine = descendants(rows, me);
  const hasRecruits = new Set(mine.map((r) => r.directUplineId).filter(Boolean) as string[]);
  return mine
    .filter((r) => r.designation !== Designation.SalesAssociate && hasRecruits.has(r.id))
    .sort((a, b) => a.associateCode.localeCompare(b.associateCode));
}

/**
 * Per-associate performance for the Downline Performance tabs.
 *  transacted  = sale value of transactions they closed
 *  commission  = their own commission on everything (ledger, excl. Cancelled)
 *  myDirect / mySecond = MY override on their deals, split by whether I sit as
 *                        their direct or second upline on that transaction.
 */
type Txn = { id: string; closingAssociateId: string; saleAmount: Prisma.Decimal | number | string; directUplineId: string | null; secondUplineId: string | null };
type Line = { transactionId: string; associateId: string | null; lineType: LedgerLineType; status: LedgerStatus; amount: Prisma.Decimal | number | string };

export function performanceByAssociate(ids: string[], txns: Txn[], lines: Line[], me: string) {
  const out = new Map<string, { transacted: Prisma.Decimal; commission: Prisma.Decimal; myDirect: Prisma.Decimal; mySecond: Prisma.Decimal }>();
  for (const id of ids) out.set(id, { transacted: ZERO, commission: ZERO, myDirect: ZERO, mySecond: ZERO });
  const txnById = new Map(txns.map((t) => [t.id, t]));
  for (const t of txns) {
    const row = out.get(t.closingAssociateId);
    if (row) row.transacted = row.transacted.add(D(t.saleAmount));
  }
  for (const l of lines) {
    if (l.status === LedgerStatus.Cancelled) continue;
    if (l.associateId && out.has(l.associateId)) {
      const row = out.get(l.associateId)!;
      row.commission = row.commission.add(D(l.amount));
    }
    if (l.associateId === me && l.lineType === LedgerLineType.Override) {
      const t = txnById.get(l.transactionId);
      const row = t && out.get(t.closingAssociateId);
      if (!t || !row) continue;
      if (t.secondUplineId === me) row.mySecond = row.mySecond.add(D(l.amount));
      else row.myDirect = row.myDirect.add(D(l.amount));
    }
  }
  for (const v of out.values()) {
    v.transacted = round2(v.transacted); v.commission = round2(v.commission);
    v.myDirect = round2(v.myDirect); v.mySecond = round2(v.mySecond);
  }
  return out;
}
