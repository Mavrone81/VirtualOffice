import { PrismaClient, AppRole, Designation, ApprovalStatus, AssociateStatus, PaymentMethod, CommissionType, ComValueType, ProductActiveStatus } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { encryptPII } from "../lib/crypto";

const prisma = new PrismaClient();

const ADDRESS = "74 Lorong 6 Geylang, Singapore 399226";
const EFF = new Date("2026-01-01");
const SEED_PASSWORD = "Enshrine#2026"; // dev seed login password (change in prod)

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

  // --- Associates (real prototype data, EN0001-EN0007) ---
  type A = {
    code: string; fullName: string; businessName?: string; mobile: string; email: string;
    nric: string; dob: string; designation: Designation; uplineCode?: string; team: string;
    approval: ApprovalStatus; status: AssociateStatus; role?: AppRole;
  };
  const assocDefs: A[] = [
    { code: "EN0001", fullName: "Sylvia Lee Chee Wei", businessName: "Sylvia Lee", mobile: "96671881", email: "sylvia.lee.cx@gmail.com", nric: "S2184892A", dob: "1963-05-28", designation: Designation.SalesDirector, team: "Sylvia Lee Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesDirector },
    { code: "EN0002", fullName: "Lim Xiong", businessName: "Vincent Lim", mobile: "98894508", email: "petafterlifesg@gmail.com", nric: "S8017722D", dob: "1980-06-15", designation: Designation.SalesDirector, team: "Vincent Lim Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesDirector },
    { code: "EN0003", fullName: "Jennifer Rk (Uma Devi Raja Krishnan)", businessName: "Jennifer Rk", mobile: "87422156", email: "uma.devi.jennifer@gmail.com", nric: "S7703318A", dob: "1977-01-29", designation: Designation.SalesAssociate, uplineCode: "EN0002", team: "Vincent Lim Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesAssociate },
    { code: "EN0004", fullName: "Lee Jong Seng", businessName: "John Lee", mobile: "97323288", email: "johnlee@mobilebellator.com", nric: "S6807723J", dob: "1968-02-20", designation: Designation.SalesAssociate, uplineCode: "EN0002", team: "Vincent Lim Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesAssociate },
    { code: "EN0005", fullName: "Lim Wai Lee", mobile: "82001390", email: "limwailee8200@gmail.com", nric: "S7013454C", dob: "1979-04-27", designation: Designation.SalesAssociate, uplineCode: "EN0002", team: "Vincent Lim Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesAssociate },
    { code: "EN0006", fullName: "Yan Bai Xiang", mobile: "87685469", email: "alexsyanbaixiang@gmail.com", nric: "S9019702I", dob: "1990-06-04", designation: Designation.SalesAssociate, uplineCode: "EN0002", team: "Vincent Lim Division", approval: ApprovalStatus.Pending, status: AssociateStatus.Inactive },
    { code: "EN0007", fullName: "Koo Hok Kian", businessName: "Frances Koo", mobile: "92221890", email: "franceskoohk@gmail.com", nric: "S6910693E", dob: "1969-03-30", designation: Designation.SalesManager, uplineCode: "EN0001", team: "Sylvia Lee Division", approval: ApprovalStatus.Approved, status: AssociateStatus.Active, role: AppRole.SalesManager },
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
        designation: a.designation, directUplineId, recruitingManager: "Angeline Teo", teamName: a.team,
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
    { email: "admin@enshrine.sg", role: AppRole.Admin },
    { email: "accounts@enshrine.sg", role: AppRole.Accounts },
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
  console.log(`   Logins: admin@enshrine.sg / accounts@enshrine.sg / <associate emails>  — password: ${SEED_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
