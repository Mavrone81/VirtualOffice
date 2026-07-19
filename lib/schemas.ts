import { z } from "zod";

// Centralized input-validation schemas for the write-side server actions
// (Phase 1d §4.2). Each schema mirrors — field-for-field — the existing input
// type of the action it will guard (Task 2/3 wire these in); see the type
// cited above each schema for the source of truth.
//
// Shared primitives ----------------------------------------------------------
// Decimal(14,2) SGD currency amounts, stored as strings (prisma/schema.prisma).
const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "money").max(20);
// Decimal(7,4) / Decimal(14,4) percentage or rate values, stored as strings.
const rate = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, "rate").max(20);
// Opaque DB id (uuid primary/foreign key).
const id = z.string().trim().min(1).max(64);
// Free-text display name.
const name = z.string().trim().min(1).max(200);
// Date-ish string — a yyyy-mm-dd value from an <input type="date">, or an
// ISO datetime; downstream code does `new Date(str)`, so only the envelope
// (non-empty, sane length) is bounded here, not the exact format.
const dateStr = z.string().trim().min(1).max(32);
// Human-issued code (e.g. associate code "EN0001").
const code = z.string().trim().min(1).max(20);
// A Net-to-Closer split share (% of net or an absolute amount) for Associate 2/3.
const splitShare = z.object({
  associateId: id,
  valueType: z.enum(["Percentage", "Absolute"]),
  value: z.number().finite().nonnegative().max(100_000_000),
});

// ---------------------------------------------------------------------------
// Sales — mirrors SubmitSaleInput (server/sales/actions.ts)
// ---------------------------------------------------------------------------
export const saleSchema = z.object({
  salesDate: dateStr,
  clientName: name,
  clientContact: z.string().trim().max(200).optional(),
  paymentPlan: z.enum(["Full Payment", "Installment"]),
  deposit: z.number().finite().nonnegative().max(100_000_000).optional(),
  installmentCount: z.number().finite().int().positive().max(360).optional(),
  lines: z
    .array(
      z.object({
        productId: id,
        lineSaleAmount: z.number().finite().positive().max(100_000_000),
        comCodeIds: z.array(id).max(50),
      }),
    )
    .min(1)
    .max(100),
  // Flow-3 Net-to-Closer split (optional).
  associate2: splitShare.optional(),
  associate3: splitShare.optional(),
});
export type SaleInput = z.infer<typeof saleSchema>;

// ---------------------------------------------------------------------------
// Com codes — mirrors the addComCode() second argument (server/products/actions.ts)
// ---------------------------------------------------------------------------
export const comCodeSchema = z.object({
  comCode: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  valueType: z.enum(["Percentage", "Absolute"]),
  value: rate,
});
export type ComCodeInput = z.infer<typeof comCodeSchema>;

// ---------------------------------------------------------------------------
// Products — mirrors ProductInput (server/products/actions.ts)
// ---------------------------------------------------------------------------
export const productSchema = z.object({
  productCode: z.string().trim().min(1).max(40),
  productName: name,
  productCategory: z.string().trim().max(100).optional(),
  commissionType: z.enum(["Percentage", "Fixed"]),
  closingCommPct: rate.optional(),
  closingCommFixed: money.optional(),
  companyCutPct: rate,
  companyCutType: z.enum(["Percentage", "Absolute"]).optional(),
  smOverridePct: rate,
  smOverrideType: z.enum(["Percentage", "Absolute"]).optional(),
  sdOverridePct: rate,
  sdOverrideType: z.enum(["Percentage", "Absolute"]).optional(),
  isExternal: z.boolean(),
  externalCompanyRetainedPct: rate.optional(),
  defaultCompanyId: id.optional(),
  effectiveDate: dateStr,
});
export type ProductSchemaInput = z.infer<typeof productSchema>;

// ---------------------------------------------------------------------------
// Associates — mirrors NewAssociateInput (server/associates/actions.ts)
// ---------------------------------------------------------------------------
export const newAssociateSchema = z.object({
  fullName: name,
  businessName: z.string().trim().max(200).optional(),
  mobileNumber: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(200).optional(),
  // Encrypted at rest (lib/crypto.ts encryptPII) — validate shape/length only.
  nric: z.string().trim().min(1).max(40).optional(),
  dateOfBirth: dateStr.optional(),
  designation: z.enum(["SalesAssociate", "SalesAssistantManager", "SalesManager", "SalesDirector"]),
  directUplineCode: code.optional(),
  teamName: z.string().trim().max(200).optional(),
  recruitingManager: z.string().trim().max(200).optional(),
  paymentMethod: z.enum(["PayNow", "Bank Transfer"]).optional(),
  paynowNumber: z.string().trim().max(40).optional(),
  bankName: z.string().trim().max(200).optional(),
  // Encrypted at rest — validate shape/length only.
  bankAccountNumber: z.string().trim().min(1).max(40).optional(),
});
export type NewAssociateSchemaInput = z.infer<typeof newAssociateSchema>;

// ---------------------------------------------------------------------------
// Onboarding — mirrors OnboardingSubmission (server/recruitment/actions.ts).
// photo/signature BYTES are sniffed by the magic-byte upload task (Phase 1d
// Task 7), not content-validated here — only their shape/size envelope is.
// ---------------------------------------------------------------------------
export const onboardingSchema = z.object({
  businessName: z.string().trim().max(200).optional(),
  // Encrypted at rest — validate shape/length only. Both local NRIC/FIN and
  // foreign-passport-style identifiers flow through here, so no fixed regex.
  nric: z.string().trim().min(1).max(40),
  dateOfBirth: dateStr.optional(),
  residentialAddress: z.string().trim().max(500).optional(),
  emergencyContactName: z.string().trim().max(200).optional(),
  emergencyContactNumber: z.string().trim().max(30).optional(),
  paymentMethod: z.enum(["PayNow", "Bank Transfer"]),
  paynowNumber: z.string().trim().max(40).optional(),
  bankName: z.string().trim().max(200).optional(),
  // Encrypted at rest — validate shape/length only.
  bankAccountNumber: z.string().trim().min(1).max(40).optional(),
  agreementAccepted: z.boolean(),
  // V-2026-07 identity addition.
  maritalStatus: z.enum(["Single", "Married", "Divorced", "Widowed"]).optional(),
  // Spouse / Conflict of Interest Declaration (V-2026-07): is the spouse working
  // for or supplying a funeral / afterlife company? If declared Yes, capture who.
  spouseConflict: z.boolean().optional(),
  spouseName: z.string().trim().max(200).optional(),
  spouseCompany: z.string().trim().max(200).optional(),
  spouseDesignation: z.string().trim().max(200).optional(),
  // Presence/type only; actual bytes are sniffed downstream (Task 7).
  photo: z.instanceof(File).nullable().optional(),
  // Base64 PNG data-URL from the signature pad — capped to bound payload
  // size; magic bytes verified downstream (Task 7), not here.
  signature: z.string().max(8_000_000).optional(),
}).superRefine((v, ctx) => {
  // A declared conflict must name the spouse + their company.
  if (v.spouseConflict === true) {
    if (!v.spouseName?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["spouseName"], message: "required" });
    if (!v.spouseCompany?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["spouseCompany"], message: "required" });
  }
});
export type OnboardingSchemaInput = z.infer<typeof onboardingSchema>;
