// Dev helper: create one pending sale submission to exercise the verify flow.
import { PrismaClient, PaymentPlan, SubmissionStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const closer = await prisma.associate.findUniqueOrThrow({ where: { associateCode: "EN0004" } });
  const product = await prisma.product.findFirstOrThrow({ where: { productCode: "FUN-BASE" } });
  const existing = await prisma.salesSubmission.findFirst({
    where: { closingAssociateId: closer.id, status: SubmissionStatus.Submitted },
  });
  if (existing) {
    console.log("A pending submission already exists for EN0004 — skipping.");
    return;
  }
  await prisma.salesSubmission.create({
    data: {
      salesDate: new Date(),
      clientName: "Jane Tan (demo)",
      clientContact: "91234567",
      saleAmount: 10000,
      paymentPlan: PaymentPlan.FullPayment,
      amountCollected: 0,
      closingAssociateId: closer.id,
      status: SubmissionStatus.Submitted,
      lineItems: {
        create: [
          {
            companyId: product.defaultCompanyId!,
            productCode: product.productCode,
            productName: product.productName,
            commissionType: product.commissionType,
            lineSaleAmount: 10000,
            isExternal: product.isExternal,
            selectedComCodes: [],
          },
        ],
      },
    },
  });
  console.log("Created demo submission for EN0004 (FUN-BASE $10,000, Full Payment).");
}

main().finally(() => prisma.$disconnect());
