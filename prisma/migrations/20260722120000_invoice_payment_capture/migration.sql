-- Payment capture on mark-Paid (Issues v1.0 #6). Additive + backward-compatible:
-- new enum + two nullable columns; existing code/rows are unaffected.
CREATE TYPE "InvoicePaymentMethod" AS ENUM ('Cash', 'Credit', 'Bank');
ALTER TABLE "invoices" ADD COLUMN "paid_method" "InvoicePaymentMethod";
ALTER TABLE "invoices" ADD COLUMN "paid_reference" TEXT;
