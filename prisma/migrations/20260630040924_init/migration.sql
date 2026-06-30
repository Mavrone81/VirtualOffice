-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('Admin', 'Accounts', 'SalesDirector', 'SalesManager', 'Consultant');

-- CreateEnum
CREATE TYPE "Designation" AS ENUM ('Sales Consultant', 'Assistant Sales Manager', 'Sales Manager', 'Sales Director');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('Pending', 'Approved', 'Rejected', 'Incomplete');

-- CreateEnum
CREATE TYPE "OnboardingStage" AS ENUM ('Invited', 'Form Submitted', 'Signed – Pending Approval', 'Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "PFileDocType" AS ENUM ('Signed Associate Agreement', 'Onboarding Submission', 'ID Document', 'HR Document', 'Other');

-- CreateEnum
CREATE TYPE "AssociateStatus" AS ENUM ('Active', 'Suspended', 'Terminated', 'Inactive');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PayNow', 'Bank Transfer');

-- CreateEnum
CREATE TYPE "PaymentPlan" AS ENUM ('Full Payment', 'Installment');

-- CreateEnum
CREATE TYPE "ProductActiveStatus" AS ENUM ('Active', 'Inactive');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('Percentage', 'Fixed');

-- CreateEnum
CREATE TYPE "ComValueType" AS ENUM ('Percentage', 'Absolute');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('Submitted', 'Verified', 'Rejected');

-- CreateEnum
CREATE TYPE "CommissionEligibility" AS ENUM ('Eligible', 'Pending Collection', 'Partially Eligible', 'Ineligible');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('Computer-Generated', 'Signature');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('Outstanding', 'Paid', 'Cancelled');

-- CreateEnum
CREATE TYPE "LedgerLineType" AS ENUM ('Personal', 'Override', 'Add-on', 'Company Retained', 'External Payable');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('Pending', 'Eligible', 'Paid', 'Cancelled');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('Pending', 'Approved', 'Paid', 'Cancelled');

-- CreateEnum
CREATE TYPE "NoticeAudience" AS ENUM ('All', 'Team', 'Role');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('Company Template', 'Associate Agreement', 'Vendor Agreement', 'Vendor MOU', 'Sales Agreement', 'Other');

-- CreateEnum
CREATE TYPE "DocumentAssignment" AS ENUM ('All', 'Team', 'Associate');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('All', 'Owner', 'Admin');

-- CreateEnum
CREATE TYPE "InstallmentPlanStatus" AS ENUM ('Active', 'Completed', 'Cancelled');

-- CreateEnum
CREATE TYPE "BankFileStatus" AS ENUM ('Generated', 'Uploaded', 'Reconciled');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('Active', 'Lapsed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AppRole" NOT NULL,
    "associate_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "intended_designation" "Designation",
    "intended_direct_upline_id" UUID,
    "intended_team" TEXT,
    "onboarding_token" TEXT NOT NULL,
    "onboarding_stage" "OnboardingStage" NOT NULL DEFAULT 'Invited',
    "submitted_payload" JSONB,
    "photo_file_key" TEXT,
    "agreement_file_key" TEXT,
    "signed_agreement_file_key" TEXT,
    "invited_by" UUID,
    "reviewed_by" UUID,
    "reject_reason" TEXT,
    "converted_associate_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "associates" (
    "id" UUID NOT NULL,
    "associate_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "business_name" TEXT,
    "mobile_number" TEXT,
    "email" TEXT,
    "nric" TEXT,
    "date_of_birth" DATE,
    "designation" "Designation" NOT NULL,
    "direct_upline_id" UUID,
    "second_upline_id" UUID,
    "recruiting_manager" TEXT,
    "team_name" TEXT,
    "payment_method" "PaymentMethod",
    "paynow_number" TEXT,
    "bank_name" TEXT,
    "bank_account_number" TEXT,
    "agreement_file_key" TEXT,
    "signed_agreement_file_key" TEXT,
    "photo_file_key" TEXT,
    "join_date" DATE,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "associate_status" "AssociateStatus" NOT NULL DEFAULT 'Inactive',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "associates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "p_files" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "associate_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "p_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pfile_documents" (
    "id" UUID NOT NULL,
    "p_file_id" UUID NOT NULL,
    "doc_type" "PFileDocType" NOT NULL,
    "title" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "filed_by" UUID,
    "filed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pfile_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "name_cards" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_id" UUID,
    "custom_title" TEXT,
    "qr_payload" TEXT,
    "last_rendered_vcf_key" TEXT,
    "last_rendered_image_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "name_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "logo_file_key" TEXT,
    "stamp_file_key" TEXT,
    "address" TEXT,
    "invoice_prefix" TEXT NOT NULL,
    "invoice_next_seq" INTEGER NOT NULL DEFAULT 1,
    "gst_registered" BOOLEAN NOT NULL DEFAULT false,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "product_code" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_category" TEXT,
    "commission_type" "CommissionType" NOT NULL DEFAULT 'Percentage',
    "closing_comm_pct" DECIMAL(7,4),
    "closing_comm_fixed" DECIMAL(14,2),
    "company_cut_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "asm_override_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "sm_override_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "sd_override_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "company_retained_pct" DECIMAL(7,4),
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "external_company_retained_pct" DECIMAL(7,4),
    "default_company_id" UUID,
    "parent_product_id" UUID,
    "active_status" "ProductActiveStatus" NOT NULL DEFAULT 'Active',
    "effective_date" DATE NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "com_codes" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "com_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value_type" "ComValueType" NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "com_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_structure_versions" (
    "id" UUID NOT NULL,
    "product_code" TEXT NOT NULL,
    "product_id" UUID,
    "effective_date" DATE NOT NULL,
    "rate_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_structure_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_submissions" (
    "id" UUID NOT NULL,
    "sales_date" DATE NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_contact" TEXT,
    "sale_amount" DECIMAL(14,2) NOT NULL,
    "payment_plan" "PaymentPlan" NOT NULL,
    "deposit" DECIMAL(14,2),
    "installment_count" INTEGER,
    "amount_collected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closing_associate_id" UUID NOT NULL,
    "invoice_file_key" TEXT,
    "remarks" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'Submitted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line_items" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "transaction_id" UUID,
    "company_id" UUID NOT NULL,
    "product_code" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "commission_type" "CommissionType" NOT NULL,
    "line_sale_amount" DECIMAL(14,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "selected_com_codes" JSONB,
    "upgrade_parent_product_id" UUID,
    "structure_version_id" UUID,
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_transactions" (
    "id" UUID NOT NULL,
    "transaction_code" TEXT NOT NULL,
    "submission_id" UUID NOT NULL,
    "sales_date" DATE NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_contact" TEXT,
    "sale_amount" DECIMAL(14,2) NOT NULL,
    "payment_plan" "PaymentPlan" NOT NULL,
    "deposit" DECIMAL(14,2),
    "installment_count" INTEGER,
    "amount_collected" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closing_associate_id" UUID NOT NULL,
    "direct_upline_id" UUID,
    "second_upline_id" UUID,
    "commission_eligibility" "CommissionEligibility" NOT NULL DEFAULT 'Ineligible',
    "agreement_file_key" TEXT,
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_type" "InvoiceType" NOT NULL DEFAULT 'Computer-Generated',
    "installment_index" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'Outstanding',
    "paid_date" TIMESTAMP(3),
    "paid_marked_by" UUID,
    "pdf_file_key" TEXT,
    "signed_pdf_file_key" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_plans" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "deposit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "installment_count" INTEGER NOT NULL,
    "adjustable_amount" DECIMAL(14,2),
    "status" "InstallmentPlanStatus" NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_schedule" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "due_amount" DECIMAL(14,2) NOT NULL,
    "due_date" DATE,
    "invoice_id" UUID,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paid_date" TIMESTAMP(3),

    CONSTRAINT "installment_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_ledger" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "line_item_id" UUID,
    "payout_month" TEXT NOT NULL,
    "associate_id" UUID,
    "associate_name" TEXT,
    "designation" "Designation",
    "line_type" "LedgerLineType" NOT NULL,
    "com_code" TEXT,
    "basis_amount" DECIMAL(14,2) NOT NULL,
    "rate_or_value" DECIMAL(14,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "is_manual_override" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "eligibility" "CommissionEligibility" NOT NULL DEFAULT 'Ineligible',
    "status" "LedgerStatus" NOT NULL DEFAULT 'Pending',
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_payouts" (
    "id" UUID NOT NULL,
    "payout_month" TEXT NOT NULL,
    "associate_id" UUID NOT NULL,
    "associate_name" TEXT NOT NULL,
    "designation" "Designation" NOT NULL,
    "personal_commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "override_commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "addon_commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_payable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_method" "PaymentMethod",
    "paynow_number" TEXT,
    "bank_name" TEXT,
    "bank_account_number" TEXT,
    "payout_status" "PayoutStatus" NOT NULL DEFAULT 'Pending',
    "paid_date" TIMESTAMP(3),
    "statement_file_key" TEXT,
    "bank_file_batch_id" UUID,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_file_batches" (
    "id" UUID NOT NULL,
    "payout_month" TEXT NOT NULL,
    "file_key" TEXT,
    "status" "BankFileStatus" NOT NULL DEFAULT 'Generated',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" UUID,

    CONSTRAINT "bank_file_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachment_file_key" TEXT,
    "audience" "NoticeAudience" NOT NULL DEFAULT 'All',
    "audience_team" TEXT,
    "audience_role" "AppRole",
    "posted_by" UUID,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notice_reads" (
    "id" UUID NOT NULL,
    "notice_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notice_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "owner_associate_id" UUID,
    "assignment" "DocumentAssignment" NOT NULL DEFAULT 'All',
    "assigned_team" TEXT,
    "assigned_associate_id" UUID,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'All',
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_referrals" (
    "id" UUID NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "vendor_type" TEXT,
    "contact" TEXT,
    "agreement_file_key" TEXT,
    "submitted_by_associate_id" UUID,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "VendorStatus" NOT NULL DEFAULT 'Active',
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_associate_id_key" ON "users"("associate_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_onboarding_token_key" ON "candidates"("onboarding_token");

-- CreateIndex
CREATE UNIQUE INDEX "associates_associate_code_key" ON "associates"("associate_code");

-- CreateIndex
CREATE INDEX "associates_direct_upline_id_idx" ON "associates"("direct_upline_id");

-- CreateIndex
CREATE INDEX "associates_approval_status_associate_status_idx" ON "associates"("approval_status", "associate_status");

-- CreateIndex
CREATE UNIQUE INDEX "p_files_user_id_key" ON "p_files"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "p_files_associate_id_key" ON "p_files"("associate_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_invoice_prefix_key" ON "companies"("invoice_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "products_product_code_effective_date_key" ON "products"("product_code", "effective_date");

-- CreateIndex
CREATE INDEX "commission_structure_versions_product_code_effective_date_idx" ON "commission_structure_versions"("product_code", "effective_date");

-- CreateIndex
CREATE INDEX "sale_line_items_submission_id_idx" ON "sale_line_items"("submission_id");

-- CreateIndex
CREATE INDEX "sale_line_items_transaction_id_idx" ON "sale_line_items"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_transactions_transaction_code_key" ON "sales_transactions"("transaction_code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_transactions_submission_id_key" ON "sales_transactions"("submission_id");

-- CreateIndex
CREATE INDEX "sales_transactions_closing_associate_id_idx" ON "sales_transactions"("closing_associate_id");

-- CreateIndex
CREATE INDEX "sales_transactions_commission_eligibility_idx" ON "sales_transactions"("commission_eligibility");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_company_id_invoice_number_key" ON "invoices"("company_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "installment_plans_transaction_id_key" ON "installment_plans"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "installment_schedule_invoice_id_key" ON "installment_schedule"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "installment_schedule_plan_id_sequence_key" ON "installment_schedule"("plan_id", "sequence");

-- CreateIndex
CREATE INDEX "commission_ledger_associate_id_payout_month_idx" ON "commission_ledger"("associate_id", "payout_month");

-- CreateIndex
CREATE INDEX "commission_ledger_transaction_id_idx" ON "commission_ledger"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_payouts_associate_id_payout_month_key" ON "monthly_payouts"("associate_id", "payout_month");

-- CreateIndex
CREATE UNIQUE INDEX "notice_reads_notice_id_user_id_key" ON "notice_reads"("notice_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_associate_id_fkey" FOREIGN KEY ("associate_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_intended_direct_upline_id_fkey" FOREIGN KEY ("intended_direct_upline_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_converted_associate_id_fkey" FOREIGN KEY ("converted_associate_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "associates" ADD CONSTRAINT "associates_direct_upline_id_fkey" FOREIGN KEY ("direct_upline_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "associates" ADD CONSTRAINT "associates_second_upline_id_fkey" FOREIGN KEY ("second_upline_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "p_files" ADD CONSTRAINT "p_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "p_files" ADD CONSTRAINT "p_files_associate_id_fkey" FOREIGN KEY ("associate_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pfile_documents" ADD CONSTRAINT "pfile_documents_p_file_id_fkey" FOREIGN KEY ("p_file_id") REFERENCES "p_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "name_cards" ADD CONSTRAINT "name_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "name_cards" ADD CONSTRAINT "name_cards_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_default_company_id_fkey" FOREIGN KEY ("default_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_parent_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "com_codes" ADD CONSTRAINT "com_codes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_structure_versions" ADD CONSTRAINT "commission_structure_versions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_submissions" ADD CONSTRAINT "sales_submissions_closing_associate_id_fkey" FOREIGN KEY ("closing_associate_id") REFERENCES "associates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_items" ADD CONSTRAINT "sale_line_items_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "sales_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_items" ADD CONSTRAINT "sale_line_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "sales_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_items" ADD CONSTRAINT "sale_line_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_items" ADD CONSTRAINT "sale_line_items_structure_version_id_fkey" FOREIGN KEY ("structure_version_id") REFERENCES "commission_structure_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "sales_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_closing_associate_id_fkey" FOREIGN KEY ("closing_associate_id") REFERENCES "associates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "sales_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "sales_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_schedule" ADD CONSTRAINT "installment_schedule_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_schedule" ADD CONSTRAINT "installment_schedule_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "sales_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "sale_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_associate_id_fkey" FOREIGN KEY ("associate_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_payouts" ADD CONSTRAINT "monthly_payouts_associate_id_fkey" FOREIGN KEY ("associate_id") REFERENCES "associates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_payouts" ADD CONSTRAINT "monthly_payouts_bank_file_batch_id_fkey" FOREIGN KEY ("bank_file_batch_id") REFERENCES "bank_file_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_associate_id_fkey" FOREIGN KEY ("owner_associate_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_assigned_associate_id_fkey" FOREIGN KEY ("assigned_associate_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_referrals" ADD CONSTRAINT "vendor_referrals_submitted_by_associate_id_fkey" FOREIGN KEY ("submitted_by_associate_id") REFERENCES "associates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
