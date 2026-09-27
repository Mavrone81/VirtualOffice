-- B-7: the payment acknowledgement (PDF/JPG/PNG) required to mark an
-- invoice/installment Paid. Two ack columns, not one, since markInstallmentPaid
-- writes InstallmentSchedule directly and does not require an Invoice row.
-- InstallmentSchedule also gains its own paidMethod/paidReference (DevLead):
-- Invoice already had these, and installments now go through the same
-- method+reference+ack dialog, so Accounts needs them visible on the row
-- without a join to the audit log.
-- Additive, nullable, no default: every existing row keeps NULL until the
-- next time it's marked paid under the new rule. Guarded, so a manual
-- re-run (or the standard `prisma migrate deploy` idempotency check) is a
-- no-op.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_ack_file_key" TEXT;
ALTER TABLE "installment_schedule" ADD COLUMN IF NOT EXISTS "payment_ack_file_key" TEXT;
ALTER TABLE "installment_schedule" ADD COLUMN IF NOT EXISTS "paid_method" "InvoicePaymentMethod";
ALTER TABLE "installment_schedule" ADD COLUMN IF NOT EXISTS "paid_reference" TEXT;
