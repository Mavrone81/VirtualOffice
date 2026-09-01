-- Consolidated-menu rework (Sep 2026):
-- 1. Referral partnership submissions gain an approval workflow + the
--    Referral & Marketing Partnership Agreement e-form fields.
-- 2. New pets_ashes_agreements table — the Storage of Pets Ashes Agreement
--    filled after quotation signing and signed in person.

-- CreateEnum
CREATE TYPE "AshesAgreementStatus" AS ENUM ('Draft', 'Signed');

-- AlterTable: vendor_referrals — approval workflow
ALTER TABLE "vendor_referrals"
  ADD COLUMN "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
  ADD COLUMN "reviewed_by" UUID,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reject_reason" TEXT,
  ADD COLUMN "agreement_date" DATE,
  ADD COLUMN "vendor_uen" TEXT,
  ADD COLUMN "vendor_address" TEXT,
  ADD COLUMN "vendor_signer_name" TEXT,
  ADD COLUMN "vendor_signer_nric" TEXT,
  ADD COLUMN "vendor_signer_designation" TEXT,
  ADD COLUMN "vendor_signature_key" TEXT,
  ADD COLUMN "company_sign_name" TEXT,
  ADD COLUMN "company_sign_designation" TEXT,
  ADD COLUMN "company_signature_key" TEXT,
  ADD COLUMN "company_signed_at" TIMESTAMP(3),
  ADD COLUMN "company_signed_by" UUID,
  ADD COLUMN "agreement_pdf_key" TEXT;

-- Backfill: rows that existed before the approval workflow were admin-curated
-- registry entries — treat them as already approved.
UPDATE "vendor_referrals" SET "approval_status" = 'Approved';

-- CreateIndex
CREATE INDEX "vendor_referrals_approval_status_idx" ON "vendor_referrals"("approval_status");

-- CreateTable
CREATE TABLE "pets_ashes_agreements" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "storage_space_location" TEXT,
    "niche_unit" TEXT,
    "pets" JSONB NOT NULL DEFAULT '[]',
    "applicant1_name" TEXT NOT NULL,
    "applicant1_nric" TEXT,
    "applicant1_address" TEXT,
    "applicant1_contact" TEXT,
    "applicant1_email" TEXT,
    "applicant2_name" TEXT,
    "applicant2_nric" TEXT,
    "applicant2_address" TEXT,
    "applicant2_contact" TEXT,
    "applicant2_email" TEXT,
    "amount_numeric" DECIMAL(14,2) NOT NULL,
    "amount_words" TEXT NOT NULL,
    "payment_plan" "PaymentPlan" NOT NULL,
    "booking_fee" DECIMAL(14,2),
    "monthly_instalment" DECIMAL(14,2),
    "instalment_day_of_month" INTEGER,
    "maintenance_start_year" INTEGER,
    "additional_terms" TEXT,
    "status" "AshesAgreementStatus" NOT NULL DEFAULT 'Draft',
    "signed_at" TIMESTAMP(3),
    "applicant_signature_key" TEXT,
    "applicant_witness_name" TEXT,
    "applicant_witness_nric" TEXT,
    "company_witness_name" TEXT,
    "company_witness_nric" TEXT,
    "agreement_pdf_key" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pets_ashes_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pets_ashes_agreements_submission_id_key" ON "pets_ashes_agreements"("submission_id");

-- AddForeignKey
ALTER TABLE "pets_ashes_agreements" ADD CONSTRAINT "pets_ashes_agreements_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "sales_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
