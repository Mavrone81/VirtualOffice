import type { AppRole } from "@prisma/client";
import { isAdminRole } from "@/lib/rbac";

/**
 * A-7: the owning associate, or an admin, may read/issue a payment voucher.
 * Called from INSIDE the voucher functions (server/vouchers/get-or-create.ts),
 * not only from the routes — the batched list function exists precisely so
 * a Server Component (A-6) can call it directly, bypassing a route-level
 * check entirely if the rule lived only there.
 */
export function canReadVoucher(voucher: { associateId: string }, principal: { associateId: string | null; role: AppRole }): boolean {
  if (isAdminRole(principal.role)) return true;
  return !!principal.associateId && principal.associateId === voucher.associateId;
}
