import type { AppRole } from "@prisma/client";
import { isAdminRole } from "./rbac";

/**
 * Who may upload/replace the signed copy of an invoice (16-Jul signed-invoice
 * precursor). The associate who closed the sale drives the flow; Business Admin
 * and Accounts may also manage it from the back office. No one else.
 */
export function canManageSignedInvoice(
  invoice: { closingAssociateId: string },
  principal: { associateId: string | null; role: AppRole },
): boolean {
  if (isAdminRole(principal.role)) return true;
  return !!principal.associateId && principal.associateId === invoice.closingAssociateId;
}
