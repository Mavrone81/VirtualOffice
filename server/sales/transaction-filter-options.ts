import { Designation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { teamScopeIds } from "@/lib/team";
import type { ParsedTransactionSearch } from "./transaction-filters";

export const MANAGER_DESIGNATIONS: Designation[] = [Designation.SalesManager, Designation.SalesDirector];

export type TransactionFilterOptions = {
  products: { productCode: string; productName: string }[];
  closers: { id: string; fullName: string }[];
  managers: { id: string; fullName: string }[];
  teamMemberIds: string[] | undefined;
};

/**
 * B-3: the dropdown option lists and the resolved downline ids for an
 * active team filter — shared by the admin Transactions / Received /
 * Receivable pages so all three build identical filter UI from one place,
 * rather than three copies that can drift.
 */
export async function transactionFilterOptions(
  sp: Pick<ParsedTransactionSearch, "designation" | "team">,
): Promise<TransactionFilterOptions> {
  const [products, closers, managers, teamMemberIds] = await Promise.all([
    prisma.product.findMany({ select: { productCode: true, productName: true }, orderBy: { productName: "asc" } }),
    prisma.associate.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    sp.designation && MANAGER_DESIGNATIONS.includes(sp.designation)
      ? prisma.associate.findMany({ where: { designation: sp.designation }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })
      : Promise.resolve([]),
    sp.team ? teamScopeIds(sp.team) : Promise.resolve(undefined),
  ]);
  return { products, closers, managers, teamMemberIds };
}
