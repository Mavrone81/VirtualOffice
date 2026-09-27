import { PrismaClient, AppRole, Designation, ApprovalStatus, AssociateStatus, PaymentMethod, CommissionType, ComValueType, ProductActiveStatus } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { encryptPII } from "../lib/crypto";
import { seedGuardError } from "../lib/seed-guard";

const prisma = new PrismaClient();

const ADDRESS = "74 Lorong 6 Geylang, Singapore 399226";
const EFF = new Date("2026-01-01");

// SEC-4/SEC-3: SEED_PASSWORD is required, in every environment — no
// hardcoded fallback of any kind. Refuse before any write rather than
// silently seeding with a published password. Logic lives in
// lib/seed-guard.ts (tested) since this script itself isn't covered by
// vitest's include globs.
const guardError = seedGuardError({ seedPassword: process.env.SEED_PASSWORD });
if (guardError) throw new Error(guardError);
// Validated non-empty by the guard above.
const SEED_PASSWORD = process.env.SEED_PASSWORD as string;

async function main() {
  const pwHash = await hash(SEED_PASSWORD);

  // --- Companies (the three real invoice entities) ---
  const companyDefs = [
    { name: "Enshrine Services", legalName: "Enshrine Services Pte Ltd", invoicePrefix: "ENS" },
    { name: "Enshrine Pets Paradise", legalName: "Enshrine Pets Paradise Pte Ltd", invoicePrefix: "EPP" },
    { name: "Enshrine Afterlife Planner", legalName: "Enshrine Afterlife Planner Pte Ltd", invoicePrefix: "EAP" },
  ];
  const companies: Record<string, string> = {};
  for (const c of companyDefs) {
    const row = await prisma.company.upsert({
      where: { invoicePrefix: c.invoicePrefix },
      update: { name: c.name, legalName: c.legalName, address: ADDRESS },
      create: { ...c, address: ADDRESS },
    });
    companies[c.invoicePrefix] = row.id;
  }

  // --- Products (one per engine path) + version snapshots + com codes ---
  const productDefs = [
    {
      productCode: "FUN-BASE", productName: "Funeral System (Base)", productCategory: "Funeral",
      commissionType: CommissionType.Percentage, closingCommPct: "10", closingCommFixed: null,
      companyCutPct: "40", asmOverridePct: "10", smOverridePct: "20", sdOverridePct: "10",
      isExternal: false, externalCompanyRetainedPct: null, defaultCompany: "ENS",
      comCodes: [
        { comCode: "SEA-SCATTER", label: "Sea Scattering", valueType: ComValueType.Percentage, value: "2" },
        { comCode: "REMEMBRANCE", label: "Remembrance", valueType: ComValueType.Absolute, value: "20" },
      ],
    },
    {
      productCode: "PET-CREMATE", productName: "Pet Cremation Package", productCategory: "Pet Aftercare",
      commissionType: CommissionType.Fixed, closingCommPct: null, closingCommFixed: "500",
      companyCutPct: "40", asmOverridePct: "10", smOverridePct: "20", sdOverridePct: "10",
      isExternal: false, externalCompanyRetainedPct: null, defaultCompany: "EPP",
      comCodes: [],
    },
    {
      productCode: "COL-NICHE", productName: "Columbarium Niche", productCategory: "Niche / Memorial",
      commissionType: CommissionType.Percentage, closingCommPct: "0", closingCommFixed: null,
      companyCutPct: "0", asmOverridePct: "0", smOverridePct: "0", sdOverridePct: "0",
      isExternal: true, externalCompanyRetainedPct: "5", defaultCompany: "EAP",
      comCodes: [],
    },
  ];

  for (const p of productDefs) {
    const product = await prisma.product.upsert({
      where: { productCode_effectiveDate: { productCode: p.productCode, effectiveDate: EFF } },
      update: {},
      create: {
        productCode: p.productCode, productName: p.productName, productCategory: p.productCategory,
        commissionType: p.commissionType, closingCommPct: p.closingCommPct, closingCommFixed: p.closingCommFixed,
        companyCutPct: p.companyCutPct, asmOverridePct: p.asmOverridePct, smOverridePct: p.smOverridePct,
        sdOverridePct: p.sdOverridePct, isExternal: p.isExternal, externalCompanyRetainedPct: p.externalCompanyRetainedPct,
        defaultCompanyId: companies[p.defaultCompany], activeStatus: ProductActiveStatus.Active, effectiveDate: EFF,
      },
    });
    await prisma.commissionStructureVersion.create({
      data: {
        productCode: p.productCode, productId: product.id, effectiveDate: EFF,
        rateSnapshot: {
          commissionType: p.commissionType, closingCommPct: p.closingCommPct, closingCommFixed: p.closingCommFixed,
          companyCutPct: p.companyCutPct, asmOverridePct: p.asmOverridePct, smOverridePct: p.smOverridePct,
          sdOverridePct: p.sdOverridePct, isExternal: p.isExternal, externalCompanyRetainedPct: p.externalCompanyRetainedPct,
        },
      },
    });
    for (const cc of p.comCodes) {
      await prisma.comcode.create({ data: { productId: product.id, ...cc } });
    }
  }

  // --- Associates (FAKE data — SEC-4. Same row count, designations and
  // upline relationships as the original prototype seed; every name, NRIC,
  // DOB, mobile and email below is synthetic. NRIC-shaped values follow the
  // S000000<n>A convention shared with reports/harness/fake-seed.integration.test.ts
  // so screenshots and seed data agree; mobiles are in the reserved-looking
  // 8000000<n> range; emails are on example.com.) ---
  type A = {
    code: string; fullName: string; businessName?: string; mobile: string; email: string;
    nric: string; dob: string; designation: Designation; uplineCode?: string; team: string;
    approval: ApprovalStatus; status: AssociateStatus; role?: AppRole;
  };
  const assocDefs: A[] = [
    { code: "EN0001", fullName: "Daniel Tan", businessName: "Daniel Tan", mobile: "80000001", email: "daniel.tan@example.com", nric: "S0000001A", dob: "1963-01-01", designation: Designation.SalesDirector, team: "Daniel Tan Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesDirector },
    { code: "EN0002", fullName: "Kevin Ong", businessName: "Kevin Ong", mobile: "80000002", email: "kevin.ong@example.com", nric: "S1234567A", dob: "1980-01-01", designation: Designation.SalesDirector, team: "Kevin Ong Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesDirector },
    { code: "EN0003", fullName: "Ravi Kumar", businessName: "Ravi Kumar", mobile: "80000003", email: "ravi.kumar@example.com", nric: "S0000003A", dob: "1977-01-01", designation: Designation.SalesAssociate, uplineCode: "EN0002", team: "Kevin Ong Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesAssociate },
    { code: "EN0004", fullName: "Wei Ling Ng", businessName: "Wei Ling Ng", mobile: "80000004", email: "wei.ling.ng@example.com", nric: "S0000004A", dob: "1968-01-01", designation: Designation.SalesAssociate, uplineCode: "EN0002", team: "Kevin Ong Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesAssociate },
    { code: "EN0005", fullName: "Priya Nair", mobile: "80000005", email: "priya.nair@example.com", nric: "S0000005A", dob: "1979-01-01", designation: Designation.SalesAssociate, uplineCode: "EN0002", team: "Kevin Ong Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesAssociate },
    { code: "EN0006", fullName: "Marcus Teo", mobile: "80000006", email: "marcus.teo@example.com", nric: "S0000006A", dob: "1990-01-01", designation: Designation.SalesAssociate, uplineCode: "EN0002", team: "Kevin Ong Division", approval: ApprovalStatus.Pending, status: AssociateStatus.Inactive },
    { code: "EN0007", fullName: "Michelle Lim", businessName: "Michelle Lim", mobile: "80000007", email: "michelle.lim@example.com", nric: "S0000007A", dob: "1969-01-01", designation: Designation.SalesManager, uplineCode: "EN0001", team: "Daniel Tan Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesManager },
  ];

  const idByCode: Record<string, string> = {};
  for (const a of assocDefs) {
    const directUplineId = a.uplineCode ? idByCode[a.uplineCode] : null;
    // 2nd upline = direct upline's direct upline (null here — all uplines are division heads)
    const row = await prisma.associate.upsert({
      where: { associateCode: a.code },
      update: {},
      create: {
        associateCode: a.code, fullName: a.fullName, businessName: a.businessName ?? null,
        mobileNumber: a.mobile, email: a.email, nric: encryptPII(a.nric), dateOfBirth: new Date(a.dob),
        designation: a.designation, directUplineId, recruitingManager: "Rachel Sim", teamName: a.team,
        paymentMethod: PaymentMethod.PayNow, paynowNumber: a.mobile,
        approvalStatus: a.approval, associateStatus: a.status, joinDate: new Date("2026-05-25"),
      },
    });
    idByCode[a.code] = row.id;

    // login + P-file for active associates with a mapped role
    if (a.role && a.status === AssociateStatus.Active) {
      const user = await prisma.user.upsert({
        where: { email: a.email },
        update: { role: a.role, associateId: row.id },
        create: { email: a.email, passwordHash: pwHash, role: a.role, associateId: row.id },
      });
      await prisma.pFile.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, associateId: row.id },
      });
    }
  }

  // --- Staff logins (Product Owner + Accounts) ---
  for (const u of [
    { email: "admin@example.com", role: AppRole.Admin },
    { email: "accounts@example.com", role: AppRole.Accounts },
  ]) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role },
      create: { email: u.email, passwordHash: pwHash, role: u.role },
    });
    await prisma.pFile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
  }

  const counts = {
    companies: await prisma.company.count(),
    products: await prisma.product.count(),
    comCodes: await prisma.comcode.count(),
    associates: await prisma.associate.count(),
    users: await prisma.user.count(),
  };
  console.log("✅ Seed complete:", counts);
  console.log("   Logins: admin@example.com / accounts@example.com / <associate emails>  — password: from SEED_PASSWORD");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
