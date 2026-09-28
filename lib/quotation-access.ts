import type { AppRole } from "@prisma/client";
import { isAdminRole } from "./rbac";

/** Who may view/void a quotation: the associate who issued it, or an admin. */
export function canManageQuotation(
  quotation: { associateId: string },
  principal: { associateId: string | null; role: AppRole },
): boolean {
  if (isAdminRole(principal.role)) return true;
  return !!principal.associateId && principal.associateId === quotation.associateId;
}
