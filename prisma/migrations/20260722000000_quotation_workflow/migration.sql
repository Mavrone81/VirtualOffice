-- Rename the terminal submission status (semantically: admin has approved the
-- quotation). Postgres 10+ RENAME VALUE is in-place, no data rewrite.
ALTER TYPE "SubmissionStatus" RENAME VALUE 'Verified' TO 'QuotationApproved';

-- Freeform documents on a sale: supporting (at submission) + signed (docket).
CREATE TYPE "SubmissionDocKind" AS ENUM ('Supporting', 'Signed');

CREATE TABLE "submission_documents" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "kind" "SubmissionDocKind" NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "submission_documents_submission_id_idx" ON "submission_documents"("submission_id");

ALTER TABLE "submission_documents" ADD CONSTRAINT "submission_documents_submission_id_fkey"
    FOREIGN KEY ("submission_id") REFERENCES "sales_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
