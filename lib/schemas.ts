import { z } from "zod";
import { NAME_CARD_CHINESE_NAME_MAX, NAME_CARD_CUSTOM_TITLE_MAX } from "./name-card-limits";

export { NAME_CARD_CHINESE_NAME_MAX, NAME_CARD_CUSTOM_TITLE_MAX };

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
// A percentage share can't exceed 100% of net (SEC-6); an absolute share is
// bounded against the real Net-to-Closer server-side (server/commission/split-bounds.ts).
const splitShare = z
  .object({
    associateId: id,
    valueType: z.enum(["Percentage", "Absolute"]),
    value: z.number().finite().nonnegative().max(100_000_000),
  })
  .refine((s) => s.valueType !== "Percentage" || s.value <= 100, { message: "splitPercentTooHigh", path: ["value"] });

// ---------------------------------------------------------------------------
// Sales — mirrors SubmitSaleInput (server/sales/actions.ts)
// ---------------------------------------------------------------------------
export const saleSchema = z
  .object({
    salesDate: dateStr,
    // Date of quotation (23-Jul parallel workflow) — filled up front at submission.
    quoteDate: dateStr.optional(),
    clientName: name,
    clientContact: z.string().trim().max(200).optional(),
    paymentPlan: z.enum(["Full Payment", "Installment"]),
    deposit: z.number().finite().nonnegative().max(100_000_000).optional(),
    // A-0b: the count is 1–24 on the server; refined below (deposit ≤ sale too).
    installmentCount: z.number().finite().int().positive().max(24).optional(),
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
    // A-17 §2: converting a quotation into this sale (informational FK; CAS'd
    // Issued -> Converted server-side in submitSale).
    quotationId: id.optional(),
  })
  // SEC-6: the percentage shares together can't exceed 100% of net, and the two
  // partners must be different people.
  .refine(
    (d) =>
      (d.associate2?.valueType === "Percentage" ? d.associate2.value : 0) +
        (d.associate3?.valueType === "Percentage" ? d.associate3.value : 0) <= 100,
    { message: "splitPercentTooHigh", path: ["associate3"] },
  )
  .refine((d) => !d.associate2 || !d.associate3 || d.associate2.associateId !== d.associate3.associateId, {
    message: "splitPartyInvalid", path: ["associate3"],
  })
  .refine(
    (d) => d.paymentPlan !== "Installment" || (d.installmentCount !== undefined && d.installmentCount >= 1),
    { message: "Installment count must be between 1 and 24", path: ["installmentCount"] },
  )
  .refine(
    (d) => {
      if (d.deposit === undefined) return true;
      const saleAmount = d.lines.reduce((s, l) => s + l.lineSaleAmount, 0);
      // Strict for Installment: deposit === sale would leave nothing to divide,
      // minting N schedule rows of $0.00 that still gate the eligibility count.
      return d.paymentPlan === "Installment" ? d.deposit < saleAmount : d.deposit <= saleAmount;
    },
    { message: "Deposit must be less than the sale amount for an installment plan", path: ["deposit"] },
  );
export type SaleInput = z.infer<typeof saleSchema>;

// ---------------------------------------------------------------------------
// A-17 — Quotation (mirrors CreateQuotationInput, server/quotations/actions.ts).
// No money/approval fields: a quotation is priced but never touches the engine.
// ---------------------------------------------------------------------------
export const quotationSchema = z.object({
  clientName: name,
  clientContact: z.string().trim().max(200).optional(),
  quoteDate: dateStr,
  validUntil: dateStr.optional(),
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
});
export type QuotationInput = z.infer<typeof quotationSchema>;

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
// A-17 screen 6 — per-product required documents (add only; the key is
// server-generated, never part of the input — see lib/product-requirement-key.ts).
// ---------------------------------------------------------------------------
export const addProductRequiredDocumentSchema = z.object({
  labelEn: z.string().trim().min(1).max(200),
  labelZh: z.string().trim().min(1).max(200),
});
export type AddProductRequiredDocumentInput = z.infer<typeof addProductRequiredDocumentSchema>;

// Bounded so the list (and the checklist UI it drives) can't grow unbounded.
export const MAX_REQUIRED_DOCUMENTS_PER_PRODUCT = 20;

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
  secondUplineCode: code.optional(),
  teamName: z.string().trim().max(200).optional(),
  recruitingManager: z.string().trim().max(200).optional(),
  paymentMethod: z.enum(["PayNow", "Bank Transfer"]).optional(),
  paynowNumber: z.string().trim().max(40).optional(),
  bankName: z.string().trim().max(200).optional(),
  // Encrypted at rest — validate shape/length only.
  bankAccountNumber: z.string().trim().min(1).max(40).optional(),
});
export type NewAssociateSchemaInput = z.infer<typeof newAssociateSchema>;

// Editing an existing associate (admin). Same core fields as creation minus the
// uplines (managed by the dedicated UplineEditor with cycle guards), plus an
// editable joinDate. nric / bankAccountNumber are keep-if-blank on edit — the
// form never prefills the encrypted values, so an empty field means "unchanged".
export const updateAssociateSchema = newAssociateSchema
  .omit({ directUplineCode: true, secondUplineCode: true })
  .extend({ joinDate: dateStr.optional() });
export type UpdateAssociateSchemaInput = z.infer<typeof updateAssociateSchema>;

// ---------------------------------------------------------------------------
// Name card (B-8) — chineseName/customTitle print on a fixed-layout card
// (components/name-card/studio.tsx), so length is capped well short of
// anything that could overflow it or break its PNG export (architect review
// Low note 1; DevLead review). chineseName renders in one centered line at a
// fixed font size — much less room than the title line, hence the tighter cap.
// The limits themselves live in ./name-card-limits (see the re-export above)
// so the client editor and the server action share one source of truth for
// matching maxLength/counters and a specific tooLong error (UIUX review)
// instead of a generic one.
// ---------------------------------------------------------------------------
export const nameCardSchema = z.object({
  chineseName: z.string().trim().max(NAME_CARD_CHINESE_NAME_MAX).optional(),
  customTitle: z.string().trim().max(NAME_CARD_CUSTOM_TITLE_MAX).optional(),
});

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
  // Printed on the Associate Agreement's particulars table, so required (28 Sep).
  nationality: z.string().trim().min(1).max(100),
  gender: z.enum(["Male", "Female"]),
  religion: z.string().trim().min(1).max(100),
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
