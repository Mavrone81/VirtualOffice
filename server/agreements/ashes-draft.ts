import { Prisma, PaymentPlan } from "@prisma/client";
import { D, round2 } from "@/lib/money";
import { amountToWords } from "@/lib/amount-words";

/**
 * A-17 §4: auto-generate the Pet Ash draft at submit when a line's product
 * requires it — prefilled from the submission, applicant 1 = the client.
 * Shared with editSale's C2 recreate-on-add path (both run inside the same
 * DB transaction as the submission write).
 */
export async function createAshesDraftTx(
  db: Prisma.TransactionClient,
  params: {
    submissionId: string;
    clientName: string;
    saleAmount: Prisma.Decimal | number | string;
    paymentPlan: PaymentPlan;
    deposit: Prisma.Decimal | number | string | null;
    installmentCount: number | null;
    createdById: string | null;
  },
): Promise<{ id: string }> {
  const isInstalment = params.paymentPlan === PaymentPlan.Installment;
  const saleAmountD = D(params.saleAmount);
  const depositD = D(params.deposit ?? 0);
  const monthly = isInstalment && params.installmentCount
    ? round2(saleAmountD.sub(depositD).div(params.installmentCount))
    : null;

  return db.petsAshesAgreement.create({
    data: {
      submissionId: params.submissionId,
      applicant1Name: params.clientName,
      pets: [],
      amountNumeric: saleAmountD,
      amountWords: amountToWords(saleAmountD.toString()),
      paymentPlan: params.paymentPlan,
      bookingFee: isInstalment ? depositD : null,
      monthlyInstalment: monthly,
      maintenanceStartYear: new Date().getFullYear() + 1,
      createdById: params.createdById,
    },
    select: { id: true },
  });
}
