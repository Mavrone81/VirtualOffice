import { SubmissionFlow, SubmissionStatus, type Prisma, type PaymentPlan } from "@prisma/client";
import { D } from "./money";

/**
 * A-17 §4/C2: the terms a Pet Ash agreement carries — amount, plan,
 * deposit/booking fee, instalments, products. The SAME snapshot shape is
 * used to (a) detect a money-relevant edit (server/sales/actions.ts), (b)
 * store `signedTerms` at signing (server/agreements/actions.ts), and (c)
 * backs G3's "signed terms still match" check in verifySale — one
 * definition, three call sites. Lives here (not in either "use server" file)
 * because a plain synchronous helper can't be exported from a Server
 * Actions module — every export there must be an async function.
 */
/**
 * A-17 (Pet Ash agreement gate): whether the application-details form (Draft
 * agreement) may be filled in / saved right now — the state immediately
 * preceding verification for the sale's OWN flow. Legacy still gates on
 * QuotationApproved (the pre-A-17 pipeline, unchanged); a ClosedDeal sale's
 * Draft is created and managed by editSale while the submission sits at
 * Submitted (it never reaches QuotationApproved at all — that status is
 * Legacy-only), so its predecessor state is Submitted instead. One
 * predicate, shared by saveAshesAgreement and the agreement page, so the two
 * can't drift apart the way they had (both hard-coded QuotationApproved,
 * which silently made every ClosedDeal sale's Draft permanently
 * unreachable). signAshesAgreement itself is deliberately NOT gated by this —
 * it never was — only the create/update step that precedes it.
 */
export function isAgreementEditableStatus(flow: SubmissionFlow, status: SubmissionStatus): boolean {
  return flow === SubmissionFlow.Legacy ? status === SubmissionStatus.QuotationApproved : status === SubmissionStatus.Submitted;
}

export function ashesTermsSnapshot(
  sub: { saleAmount: Prisma.Decimal; paymentPlan: PaymentPlan; deposit: Prisma.Decimal | null; installmentCount: number | null },
  lines: { productCode: string }[],
) {
  return {
    saleAmount: D(sub.saleAmount).toFixed(2),
    paymentPlan: sub.paymentPlan,
    deposit: sub.deposit !== null ? D(sub.deposit).toFixed(2) : null,
    installmentCount: sub.installmentCount,
    products: lines.map((l) => l.productCode).sort(),
  };
}
