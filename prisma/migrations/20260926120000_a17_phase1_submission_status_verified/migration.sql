-- A-17 phase 1, step 2 of 2 (✎D2): adds the `Verified` value to
-- SubmissionStatus. Deliberately its OWN migration with NOTHING else in it —
-- Postgres allows ADD VALUE inside a transaction (PG12+), but the new value
-- can't be READ or WRITTEN in that same transaction, so isolating this one
-- statement keeps every other client able to read sales_submissions
-- throughout the deploy (see §9's two-phase deploy note). Nothing here
-- writes 'Verified' to any row; that only happens once phase-2 code, gated
-- on SEC-12, is live.
ALTER TYPE "SubmissionStatus" ADD VALUE IF NOT EXISTS 'Verified';
