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

/**
 * B-7 (owner ruling): who may view a payment acknowledgement — the closing
 * associate (same "uploading associate" notion as canManageSignedInvoice,
 * above), their upline, or admin. "Upline" here is the two tiers the
 * register tracks on Associate — `directUplineId` and `secondUplineId` —
 * not a recursive walk (AD, 2026-10-02): there's no existing notion
 * of "upline" deeper than that stored anywhere in the schema, and
 * `downlineIds()` in lib/rbac.ts walks the opposite direction.
 */
export function canViewPaymentAck(
  invoice: {
    closingAssociateId: string;
    closingAssociateDirectUplineId: string | null;
    closingAssociateSecondUplineId: string | null;
  },
  principal: { associateId: string | null; role: AppRole },
): boolean {
  if (isAdminRole(principal.role)) return true;
  if (!principal.associateId) return false;
  return (
    principal.associateId === invoice.closingAssociateId ||
    principal.associateId === invoice.closingAssociateDirectUplineId ||
    principal.associateId === invoice.closingAssociateSecondUplineId
  );
}
