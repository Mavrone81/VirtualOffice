import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { transactionScopeIds } from "@/lib/transaction-scope";
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
 * Portal "My Transactions" rows (associate-portal changes, Sep 2026 — A5).
 * Same visibility and variant rules as visibleTransactions, plus what the new
 * columns need: submission date, invoices, and the ledger lines.
 */
export async function myTransactionRows(variant: TransactionVariant) {
  const session = await auth();
  if (!session?.user) return null;

  const ids = await transactionScopeIds(session.user.role, session.user.associateId ?? null);
  const rows = await prisma.salesTransaction.findMany({
    where: ids === null ? {} : { closingAssociateId: { in: ids } },
    orderBy: { salesDate: "desc" },
    include: {
      lineItems: { select: { productName: true } },
      submission: { select: { createdAt: true } },
      invoices: { select: { id: true, invoiceNumber: true, amount: true }, orderBy: { createdAt: "asc" } },
      ledgerLines: { select: { associateId: true, lineType: true, status: true, amount: true } },
    },
  });

  if (variant === "received") return rows.filter((r) => r.amountCollected.gt(0));
  if (variant === "receivable") return rows.filter((r) => r.saleAmount.gt(r.amountCollected));
  return rows;
}

export type MyTransactionRow = NonNullable<Awaited<ReturnType<typeof myTransactionRows>>>[number];
