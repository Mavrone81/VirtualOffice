-- UAT tracker: tester-recorded pass/fail/blocked per test case.
CREATE TYPE "UatStatus" AS ENUM ('Untested', 'Pass', 'Fail', 'Blocked');

CREATE TABLE "uat_results" (
    "id" UUID NOT NULL,
    "case_id" TEXT NOT NULL,
    "tester_name" TEXT NOT NULL,
    "status" "UatStatus" NOT NULL DEFAULT 'Untested',
    "notes" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "uat_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uat_results_case_id_tester_name_key" ON "uat_results"("case_id", "tester_name");
CREATE INDEX "uat_results_tester_name_idx" ON "uat_results"("tester_name");
