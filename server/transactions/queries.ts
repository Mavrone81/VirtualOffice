import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { transactionScopeIds } from "@/lib/transaction-scope";
import { dashboardScopeIds } from "@/server/dashboard/metrics";
import { directRecruits } from "@/lib/rbac";
import { parseDownlineParam, resolveDownlineFilter } from "@/lib/downline-search-params";
import type { AppRole } from "@prisma/client";
import type { TransactionRow } from "@/components/transactions/transactions-table";

export type TransactionVariant = "list" | "received" | "receivable";

/**
 * Transactions visible to the signed-in user (consolidated menu, Sep 2026),
 * per the visibility ladder in lib/transaction-scope.ts, narrowed by variant:
 *  - "received":   something has been collected (amountCollected > 0)
 *  - "receivable": an outstanding balance remains (saleAmount > amountCollected)
 * Outstanding compares two columns, which Prisma's where cannot express, so
 * variants filter in JS — transaction volumes here are small.
 */
export async function visibleTransactions(variant: TransactionVariant): Promise<TransactionRow[] | null> {
  const session = await auth();
  if (!session?.user) return null;

  const ids = await transactionScopeIds(session.user.role, session.user.associateId ?? null);
  const rows = await prisma.salesTransaction.findMany({
    where: ids === null ? {} : { closingAssociateId: { in: ids } },
    orderBy: { salesDate: "desc" },
    include: { closingAssociate: true, lineItems: true },
  });

  if (variant === "received") return rows.filter((r) => r.amountCollected.gt(0));
  if (variant === "receivable") return rows.filter((r) => r.saleAmount.gt(r.amountCollected));
  return rows;
}

/**
 * The downline filter's resolved id set, or null when no (valid) filter is
 * active. The raw URL param is a CANDIDATE: it is resolved against the
 * viewer's own direct recruits (re-read here) and intersected with `scope`,
 * so it can only narrow. Shared by the table query and the headline tiles so
 * both aggregate over the identical set.
 */
export async function downlineFilterIds(
  me: string | null,
  scope: string[] | null,
  downlineParam?: string | string[],
): Promise<string[] | null> {
  const input = parseDownlineParam(downlineParam);
  if (!me || !input) return null;
  return resolveDownlineFilter(me, input, (await directRecruits(me)).map((r) => r.id), scope);
}

/**
 * Associate ids the My Transactions headline tiles aggregate over.
 *  - No active filter: exactly the pre-existing tile scope (unchanged path).
 *  - Filter active: the same resolved id set the table uses (same candidate
 *    check, same intersection with transactionScopeIds).
 * The pre-existing tile-vs-table scope difference is deliberately NOT touched.
 */
export async function tileScopeIds(role: AppRole | null, me: string | null, downlineParam?: string | string[]): Promise<string[] | null> {
  const narrowed =
    role && me && parseDownlineParam(downlineParam)
      ? await downlineFilterIds(me, await transactionScopeIds(role, me), downlineParam)
      : null;
  return narrowed ?? (role && me ? await dashboardScopeIds(role, me) : me ? [me] : []);
}

/**
 * Portal "My Transactions" rows (associate-portal changes, Sep 2026 — A5).
 * Same visibility and variant rules as visibleTransactions, plus what the new
 * columns need: submission date, invoices, and the ledger lines.
 */
export async function myTransactionRows(variant: TransactionVariant, downlineParam?: string | string[]) {
  const session = await auth();
  if (!session?.user) return null;

  const me = session.user.associateId ?? null;
  const scope = await transactionScopeIds(session.user.role, me);
  const narrowed = await downlineFilterIds(me, scope, downlineParam);
  const ids = narrowed ?? scope;
  const rows = await prisma.salesTransaction.findMany({
    where: ids === null ? {} : { closingAssociateId: { in: ids } },
    orderBy: { salesDate: "desc" },
    include: {
      lineItems: { select: { productName: true } },
      submission: { select: { createdAt: true } },
      invoices: { select: { id: true, invoiceNumber: true, amount: true }, orderBy: { createdAt: "asc" } },
      ledgerLines: { select: { associateId: true, lineType: true, status: true, amount: true, payout: { select: { payoutStatus: true } } } },
    },
  });

  if (variant === "received") return rows.filter((r) => r.amountCollected.gt(0));
  if (variant === "receivable") return rows.filter((r) => r.saleAmount.gt(r.amountCollected));
  return rows;
}

export type MyTransactionRow = NonNullable<Awaited<ReturnType<typeof myTransactionRows>>>[number];
