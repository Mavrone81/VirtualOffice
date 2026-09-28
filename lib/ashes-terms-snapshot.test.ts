import { describe, it, expect } from "vitest";
import { SubmissionFlow, SubmissionStatus } from "@prisma/client";
import { isAgreementEditableStatus } from "@/lib/ashes-terms-snapshot";

// A-17 (Pet Ash agreement gate): the shared predicate both saveAshesAgreement
// and the agreement page use. Legacy's predecessor-to-verification state is
// QuotationApproved (unchanged); ClosedDeal's is Submitted, because a
// ClosedDeal sale's Draft agreement is created and managed by editSale while
// the submission sits at Submitted — it never reaches QuotationApproved at
// all (that status is Legacy-only).
describe("isAgreementEditableStatus", () => {
  it("Legacy: editable at QuotationApproved only", () => {
    expect(isAgreementEditableStatus(SubmissionFlow.Legacy, SubmissionStatus.QuotationApproved)).toBe(true);
    expect(isAgreementEditableStatus(SubmissionFlow.Legacy, SubmissionStatus.Submitted)).toBe(false);
    expect(isAgreementEditableStatus(SubmissionFlow.Legacy, SubmissionStatus.Verified)).toBe(false);
    expect(isAgreementEditableStatus(SubmissionFlow.Legacy, SubmissionStatus.Rejected)).toBe(false);
  });

  it("ClosedDeal: editable at Submitted only — the bug this fixes", () => {
    expect(isAgreementEditableStatus(SubmissionFlow.ClosedDeal, SubmissionStatus.Submitted)).toBe(true);
    // Never reachable in practice (ClosedDeal never enters QuotationApproved),
    // but the predicate must still refuse it rather than silently allow it.
    expect(isAgreementEditableStatus(SubmissionFlow.ClosedDeal, SubmissionStatus.QuotationApproved)).toBe(false);
    expect(isAgreementEditableStatus(SubmissionFlow.ClosedDeal, SubmissionStatus.Verified)).toBe(false);
    expect(isAgreementEditableStatus(SubmissionFlow.ClosedDeal, SubmissionStatus.Rejected)).toBe(false);
  });
});
