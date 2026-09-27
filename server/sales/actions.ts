"use server";

import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import {
  Prisma, PaymentPlan, SubmissionStatus, CommissionEligibility, InvoiceType, InvoiceStatus, ComValueType, SubmissionDocKind, Designation,
  AssociateStatus, ApprovalStatus,
} from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole, isFullAdmin } from "@/lib/rbac";
import { isSdApproved, sdApproverId, pickSplitDirectorId, splitFullyApproved } from "@/lib/approval";
import { D, round2, sum, ZERO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { runCommission } from "@/server/commission/run";
import { splitBoundViolations, snapshotCovers, sameViolations, type SplitBoundViolation } from "@/server/commission/split-bounds";
import { validate } from "@/lib/validate";
import { saleSchema } from "@/lib/schemas";
import { addSubmissionDocuments } from "@/server/documents/submission-docs";


/**
 * Concurrency-safe transaction code. Postgres serializes `nextval`, so two
 * simultaneous verifications can never mint the same code — unlike the old
 * `count()+1`, where both counted N and both emitted TXN-{N+1}. Takes a tx
 * client so it runs inside approveQuotation's transaction; gaps on rollback are
 * acceptable for an opaque code.
 */
export async function nextTransactionCode(
  db: Prisma.TransactionClient | typeof prisma,
): Promise<string> {
  const rows = await db.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('transaction_code_seq')`;
  const n = Number(rows[0].nextval);
  return `TXN-${String(n).padStart(4, "0")}`;
}

export type SubmitSaleInput = {
  salesDate: string;
  quoteDate?: string;
  clientName: string;
  clientContact?: string;
  paymentPlan: "Full Payment" | "Installment";
  deposit?: number;
  installmentCount?: number;
  lines: { productId: string; lineSaleAmount: number; comCodeIds: string[] }[];
  associate2?: { associateId: string; valueType: "Percentage" | "Absolute"; value: number };
  associate3?: { associateId: string; valueType: "Percentage" | "Absolute"; value: number };
  documents?: File[]; // optional supporting documents (16-Jul quotation workflow); not validated by saleSchema
};

/** Resolve submitted lines into persisted line-item data + the total. Shared by
 * submitSale + editSale so both build line items identically. */
async function resolveSaleLines(lines: { productId: string; lineSaleAmount: number; comCodeIds: string[] }[]) {
  const products = await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, include: { comCodes: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const lineData = lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p) throw new Error("Unknown product");
    const selected = p.comCodes
      .filter((c) => l.comCodeIds.includes(c.id))
      .map((c) => ({ comCode: c.comCode, label: c.label, valueType: c.valueType, value: c.value.toString() }));
    return {
      companyId: p.defaultCompanyId ?? products[0].defaultCompanyId!,
      productCode: p.productCode,
      productName: p.productName,
      commissionType: p.commissionType,
      lineSaleAmount: round2(l.lineSaleAmount),
      isExternal: p.isExternal,
      selectedComCodes: selected,
    };
  });
  return { lineData, saleAmount: sum(lineData.map((l) => l.lineSaleAmount)) };
}

/** The submission's split columns from the validated input. */
function splitColumns(
  a2?: { associateId: string; valueType: string; value: number },
  a3?: { associateId: string; valueType: string; value: number },
) {
  return {
    associate2Id: a2?.associateId ?? null, associate2ValueType: a2 ? (a2.valueType as ComValueType) : null, associate2Value: a2 ? round2(a2.value) : null,
    associate3Id: a3?.associateId ?? null, associate3ValueType: a3 ? (a3.valueType as ComValueType) : null, associate3Value: a3 ? round2(a3.value) : null,
  };
}

/** Validation codes from saleSchema refinements that have their own message. */
const SALE_ERROR_CODES = new Set(["splitPercentTooHigh", "splitPartyInvalid"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SEC-6: a split partner must be a real, active, approved, non-archived associate
 * other than the closer (the UI only offered those; the server never checked).
 */
async function splitPartiesError(
  closerId: string,
  a2?: { associateId: string } | null,
  a3?: { associateId: string } | null,
): Promise<"splitPartyInvalid" | null> {
  const ids = [a2?.associateId, a3?.associateId].filter((x): x is string => !!x);
  if (ids.length === 0) return null;
  if (ids.includes(closerId) || new Set(ids).size !== ids.length || !ids.every((i) => UUID_RE.test(i))) return "splitPartyInvalid";
  const ok = await prisma.associate.count({
    where: { id: { in: ids }, associateStatus: AssociateStatus.Active, approvalStatus: ApprovalStatus.Approved, archivedAt: null },
  });
  return ok === ids.length ? null : "splitPartyInvalid";
}

/** A sale that books a negative commission line (B-S6): allowed, but flagged for a split exception. */
export type SplitWarning = { code: "splitExceedsNet"; lines: SplitBoundViolation[] };

export async function submitSale(input: SubmitSaleInput): Promise<{ ok: boolean; error?: string; id?: string; warning?: SplitWarning }> {
  const t = await getTranslations("errors");
  const v = validate(saleSchema, input);
  if (!v.ok) return { ok: false, error: t(v.code && SALE_ERROR_CODES.has(v.code) ? v.code : "invalidInput") };
  const validInput = v.data;

  const session = await auth();
  if (!session?.user.associateId) return { ok: false, error: t("noAssociateProfile") };
  const closerId = session.user.associateId;
  const partyError = await splitPartiesError(closerId, validInput.associate2, validInput.associate3);
  if (partyError) return { ok: false, error: t(partyError) };

  // Split director defaults to the closer's team director (23-Jul, issue 2): the
  // earliest active directed team the closer belongs to (the "first" SD when in
  // several teams); fall back to the nearest upline SD.
  const [teams, closer] = await Promise.all([
    prisma.team.findMany({
      where: { active: true, directorId: { not: null }, members: { some: { associateId: closerId } } },
      orderBy: { createdAt: "asc" },
      select: { directorId: true },
    }),
    prisma.associate.findUnique({
      where: { id: closerId },
      select: {
        directUplineId: true, secondUplineId: true,
        directUpline: { select: { designation: true } },
        secondUpline: { select: { designation: true } },
      },
    }),
  ]);
  const splitDirectorId = pickSplitDirectorId(teams) ?? (closer ? sdApproverId(closer) : null);

  const { lineData, saleAmount } = await resolveSaleLines(validInput.lines);

  // B-S6 (the project owner: warn, don't block): a split that would book any commission line below
  // zero is ALLOWED, but flagged — it needs a Business Admin split exception before closing.
  const violations = await splitBoundViolations(prisma, {
    salesDate: new Date(validInput.salesDate), closingAssociateId: closerId, lines: lineData,
    ...splitColumns(validInput.associate2, validInput.associate3),
  });

  const created = await prisma.salesSubmission.create({
    select: { id: true },
    data: {
      salesDate: new Date(validInput.salesDate),
      quoteDate: validInput.quoteDate ? new Date(validInput.quoteDate) : null,
      splitDirectorId,
      clientName: validInput.clientName.trim(),
      clientContact: validInput.clientContact?.trim() || null,
      saleAmount,
      paymentPlan: validInput.paymentPlan === "Installment" ? PaymentPlan.Installment : PaymentPlan.FullPayment,
      deposit: validInput.deposit ? round2(validInput.deposit) : null,
      installmentCount: validInput.paymentPlan === "Installment" ? validInput.installmentCount ?? null : null,
      amountCollected: 0,
      closingAssociateId: session.user.associateId,
      associate2Id: validInput.associate2?.associateId ?? null,
      associate2ValueType: validInput.associate2 ? (validInput.associate2.valueType as ComValueType) : null,
      associate2Value: validInput.associate2 ? round2(validInput.associate2.value) : null,
      associate3Id: validInput.associate3?.associateId ?? null,
      associate3ValueType: validInput.associate3 ? (validInput.associate3.valueType as ComValueType) : null,
      associate3Value: validInput.associate3 ? round2(validInput.associate3.value) : null,
      status: SubmissionStatus.Submitted,
      splitExceptionRequired: violations.length > 0,
      lineItems: { create: lineData },
    },
  });
  if (violations.length) {
    await logAudit({ action: "split.exception_flagged", entityType: "SalesSubmission", entityId: created.id, actorUserId: session.user.id, after: { lines: violations } });
  }

  // Optional supporting documents (freeform) — never fail the sale over a doc.
  if (input.documents?.length) {
    await addSubmissionDocuments(created.id, input.documents, SubmissionDocKind.Supporting, session.user.id);
  }

  revalidatePath("/portal/sales");
  revalidatePath("/admin/quotations");
  if (violations.length) revalidatePath("/admin/split-approvals");
  return violations.length ? { ok: true, id: created.id, warning: { code: "splitExceedsNet", lines: violations } } : { ok: true, id: created.id };
}

/**
 * Edit a still-Submitted sale (Issues v1.0 — My Sales). The closing associate
 * may change client / line / split details until an admin has approved it.
 * Rebuilds the line items + total; supporting documents are managed separately.
 */
export async function editSale(input: SubmitSaleInput & { id: string }): Promise<{ ok: boolean; error?: string; warning?: SplitWarning }> {
  const t = await getTranslations("errors");
  const v = validate(saleSchema, input);
  if (!v.ok) return { ok: false, error: t(v.code && SALE_ERROR_CODES.has(v.code) ? v.code : "invalidInput") };
  const validInput = v.data;

  const session = await auth();
  if (!session?.user.associateId) return { ok: false, error: t("noAssociateProfile") };

  const existing = await prisma.salesSubmission.findUnique({
    where: { id: input.id },
    select: {
      closingAssociateId: true, status: true, salesDate: true, saleAmount: true,
      associate2Id: true, associate2ValueType: true, associate2Value: true,
      associate3Id: true, associate3ValueType: true, associate3Value: true,
      sdApprovedAt: true, splitAdminApprovedAt: true, splitExceptionApprovedAt: true,
      lineItems: { select: { productCode: true, lineSaleAmount: true, selectedComCodes: true } },
    },
  });
  if (!existing) return { ok: false, error: t("notFound") };
  if (existing.closingAssociateId !== session.user.associateId) return { ok: false, error: t("forbidden") };
  if (existing.status !== SubmissionStatus.Submitted) return { ok: false, error: t("alreadyProcessed") };
  const partyError = await splitPartiesError(existing.closingAssociateId, validInput.associate2, validInput.associate3);
  if (partyError) return { ok: false, error: t(partyError) };

  const { lineData, saleAmount } = await resolveSaleLines(validInput.lines);
  const next = {
    salesDate: new Date(validInput.salesDate),
    quoteDate: validInput.quoteDate ? new Date(validInput.quoteDate) : null,
    clientName: validInput.clientName.trim(),
    clientContact: validInput.clientContact?.trim() || null,
    saleAmount,
    paymentPlan: validInput.paymentPlan === "Installment" ? PaymentPlan.Installment : PaymentPlan.FullPayment,
    deposit: validInput.deposit ? round2(validInput.deposit) : null,
    installmentCount: validInput.paymentPlan === "Installment" ? validInput.installmentCount ?? null : null,
    associate2Id: validInput.associate2?.associateId ?? null,
    associate2ValueType: validInput.associate2 ? (validInput.associate2.valueType as ComValueType) : null,
    associate2Value: validInput.associate2 ? round2(validInput.associate2.value) : null,
    associate3Id: validInput.associate3?.associateId ?? null,
    associate3ValueType: validInput.associate3 ? (validInput.associate3.valueType as ComValueType) : null,
    associate3Value: validInput.associate3 ? round2(validInput.associate3.value) : null,
  };

  // B-S6: re-check the edited sale; still allowed, but flagged when a line would go negative.
  const violations = await splitBoundViolations(prisma, {
    salesDate: next.salesDate, closingAssociateId: existing.closingAssociateId, lines: lineData,
    associate2Id: next.associate2Id, associate2ValueType: next.associate2ValueType, associate2Value: next.associate2Value,
    associate3Id: next.associate3Id, associate3ValueType: next.associate3ValueType, associate3Value: next.associate3Value,
  });

  // SEC-5 / M2: the split approvals (SD + Business Admin) were given for a specific
  // split on specific amounts. If anything that feeds the commission split changes —
  // the split parties/values, the lines (product, amount, add-on codes) or the sales
  // date (which picks the rate version) — those approvals no longer cover the sale
  // and are cleared, so flow A must be approved again before it can close.
  const before = splitTerms(existing);
  const after = splitTerms({ ...next, lineItems: lineData });
  const splitChanged = JSON.stringify(before) !== JSON.stringify(after);
  const hadApproval = !!existing.sdApprovedAt || !!existing.splitAdminApprovedAt;
  const clearApprovals = splitChanged
    ? {
        sdApprovedAt: null, sdApprovedById: null, splitAdminApprovedAt: null, splitAdminApprovedById: null, splitEditedAt: new Date(),
        // B-S6: any split edit voids a split exception too — it was given for the old terms.
        splitExceptionApprovedAt: null, splitExceptionApprovedById: null, splitExceptionReason: null,
        splitExceptionSnapshot: Prisma.DbNull, splitExceptionVersion: null,
      }
    : {};
  const exceptionVoided = splitChanged && !!existing.splitExceptionApprovedAt;

  try {
    await prisma.$transaction(async (db) => {
      // Compare-and-swap: only a still-Submitted sale of this closer is edited, so an
      // approval of the quotation landing after the read above can't be edited past.
      const res = await db.salesSubmission.updateMany({
        where: { id: input.id, closingAssociateId: session.user.associateId!, status: SubmissionStatus.Submitted },
        data: { ...next, ...clearApprovals, splitExceptionRequired: violations.length > 0 },
      });
      if (res.count !== 1) throw new EditConflict();
      await db.saleLineItem.deleteMany({ where: { submissionId: input.id } });
      await db.saleLineItem.createMany({ data: lineData.map((l) => ({ ...l, submissionId: input.id })) });
    });
  } catch (e) {
    if (e instanceof EditConflict) return { ok: false, error: t("alreadyProcessed") };
    throw e;
  }

  await logAudit({
    action: "sale.edited", entityType: "SalesSubmission", entityId: input.id, actorUserId: session.user.id,
    before, after: { ...after, splitChanged, approvalsCleared: splitChanged && hadApproval },
  });
  if (exceptionVoided) {
    await logAudit({ action: "split.exception_voided", entityType: "SalesSubmission", entityId: input.id, actorUserId: session.user.id, after: { reason: "edit" } });
  }
  if (violations.length && splitChanged) {
    await logAudit({ action: "split.exception_flagged", entityType: "SalesSubmission", entityId: input.id, actorUserId: session.user.id, after: { lines: violations } });
  }
  revalidatePath("/portal/sales");
  revalidatePath(`/portal/sales/${input.id}`);
  if (splitChanged && (hadApproval || violations.length)) {
    revalidatePath("/portal/approvals");
    revalidatePath("/admin/split-approvals");
  }
  return violations.length ? { ok: true, warning: { code: "splitExceedsNet", lines: violations } } : { ok: true };
}

class EditConflict extends Error {}

/**
 * After a missed approval compare-and-swap: true when someone already approved the
 * SAME split version (a double click / two approvers at once — idempotent success),
 * false when the split was edited since the page was rendered.
 */
async function sameTermsAlready(id: string, seen: Date | null, step: "sd" | "admin"): Promise<boolean> {
  const now = await prisma.salesSubmission.findUnique({
    where: { id }, select: { splitEditedAt: true, sdApprovedAt: true, splitAdminApprovedAt: true },
  });
  if (!now) return false;
  const sameVersion = (now.splitEditedAt?.getTime() ?? null) === (seen?.getTime() ?? null);
  return sameVersion && (step === "sd" ? now.sdApprovedAt !== null : now.splitAdminApprovedAt !== null);
}

/** The splitEditedAt an approver's page rendered (ISO string, or null = never edited). */
function seenAt(v: string | null | undefined): Date | null | "invalid" {
  if (v === null || v === undefined) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

type SplitSource = {
  salesDate: Date; saleAmount: Prisma.Decimal | string | number;
  associate2Id: string | null; associate2ValueType: ComValueType | null; associate2Value: Prisma.Decimal | string | number | null;
  associate3Id: string | null; associate3ValueType: ComValueType | null; associate3Value: Prisma.Decimal | string | number | null;
  lineItems: { productCode: string; lineSaleAmount: Prisma.Decimal | string | number; selectedComCodes?: unknown }[];
};

/** The commission-relevant terms of a sale, normalised so before/after compare exactly (and audit cleanly). */
function splitTerms(s: SplitSource) {
  const money = (v: Prisma.Decimal | string | number | null) => (v === null ? null : D(v).toFixed(2));
  const codes = (c: unknown) =>
    (Array.isArray(c) ? c : []).map((x) => String((x as { comCode?: unknown }).comCode ?? "")).sort();
  return {
    salesDate: format(s.salesDate, "yyyy-MM-dd"),
    saleAmount: money(s.saleAmount),
    associate2: s.associate2Id ? { id: s.associate2Id, type: s.associate2ValueType, value: money(s.associate2Value) } : null,
    associate3: s.associate3Id ? { id: s.associate3Id, type: s.associate3ValueType, value: money(s.associate3Value) } : null,
    lines: s.lineItems
      .map((l) => ({ product: l.productCode, amount: money(l.lineSaleAmount), codes: codes(l.selectedComCodes) }))
      .sort((a, b) => (a.product + a.amount).localeCompare(b.product + b.amount)),
  };
}

/**
 * SD approval of a submission's share-com split (16-Jul §4). The team SD (or a
 * Business Admin) approves; after 3 days it auto-approves without this call.
 * Idempotent; only valid while the submission is still Submitted.
 */
export async function approveSubmissionSplit(
  submissionId: string,
  seenSplitEditedAt: string | null = null,
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({ where: { id: submissionId }, select: { status: true, sdApprovedAt: true, closingAssociateId: true, closedAt: true, splitEditedAt: true } });
  if (!sub) return { ok: false, error: t("notFound") };

  // Approval follows the team (16-Jul §7): a Business Admin, or a Director of a
  // team the closer belongs to, may approve the split.
  let allowed = isFullAdmin(session.user.role);
  if (!allowed && session.user.associateId) {
    const team = await prisma.team.findFirst({
      where: { directorId: session.user.associateId, active: true, members: { some: { associateId: sub.closingAssociateId } } },
      select: { id: true },
    });
    allowed = !!team;
  }
  if (!allowed) return { ok: false, error: t("forbidden") };

  // Flow A (split) runs in parallel with flow B (quotation), so the SD step stays
  // open until the sale closes — same window as adminApproveSplit. This matters when
  // an edit cleared the split approvals after the quotation was already approved
  // (SEC-5): the SD must still be able to re-approve rather than wait for the 3-day auto.
  if (sub.status === SubmissionStatus.Rejected || sub.closedAt) return { ok: false, error: t("alreadyProcessed") };
  if (sub.sdApprovedAt) { revalidatePath("/admin/quotations"); return { ok: true }; }

  // SA-1: approve only the split terms the approver saw. The page sends the
  // splitEditedAt it rendered; if the closer edited the split since, the approval is
  // refused (compare-and-swap), so a stale page can't approve terms nobody saw.
  const seen = seenAt(seenSplitEditedAt);
  if (seen === "invalid") return { ok: false, error: t("splitChangedReload") };
  const res = await prisma.salesSubmission.updateMany({
    where: { id: submissionId, sdApprovedAt: null, splitEditedAt: seen },
    data: { sdApprovedAt: new Date(), sdApprovedById: session.user.id },
  });
  if (res.count === 0) return (await sameTermsAlready(submissionId, seen, "sd")) ? { ok: true } : { ok: false, error: t("splitChangedReload") };
  await logAudit({ action: "submission.sd_approved", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id });
  revalidatePath("/admin/quotations");
  revalidatePath("/portal/approvals");
  return { ok: true };
}

/**
 * Revert a split approval (Issues v1.0 — Split Approvals). The Director (or a
 * Business Admin) may undo their approval as long as the admin has not yet
 * approved the quotation (status still Submitted). Same team-based permission as
 * approving. Clears the approval stamp so it returns to the pending queue.
 */
export async function revertSplitApproval(submissionId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({ where: { id: submissionId }, select: { status: true, sdApprovedAt: true, splitAdminApprovedAt: true, closingAssociateId: true } });
  if (!sub) return { ok: false, error: t("notFound") };

  let allowed = isFullAdmin(session.user.role);
  if (!allowed && session.user.associateId) {
    const team = await prisma.team.findFirst({
      where: { directorId: session.user.associateId, active: true, members: { some: { associateId: sub.closingAssociateId } } },
      select: { id: true },
    });
    allowed = !!team;
  }
  if (!allowed) return { ok: false, error: t("forbidden") };

  if (sub.status !== SubmissionStatus.Submitted) return { ok: false, error: t("alreadyProcessed") };
  if (!sub.sdApprovedAt) return { ok: false, error: t("alreadyProcessed") };
  // Once the Business Admin has signed off the split, the SD step is locked.
  if (sub.splitAdminApprovedAt) return { ok: false, error: t("alreadyProcessed") };

  await prisma.salesSubmission.update({ where: { id: submissionId }, data: { sdApprovedAt: null, sdApprovedById: null } });
  await logAudit({ action: "submission.split_reverted", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id });
  revalidatePath("/portal/approvals");
  revalidatePath("/admin/quotations");
  return { ok: true };
}

/**
 * Business Admin signs off the share-com split (23-Jul parallel workflow, flow
 * A step 2). Follows the SD's approval (or the 3-day auto-approve); this is the
 * second, admin step shown on /admin/split-approvals. When the SD step only
 * auto-approved (never an explicit SD action), stamp sdApprovedAt now as a
 * system approval so the split's history is complete. Idempotent; only valid
 * while the sale is unclosed (no transaction yet).
 */
export async function adminApproveSplit(
  submissionId: string,
  seenSplitEditedAt: string | null = null,
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({
    where: { id: submissionId },
    select: { status: true, sdApprovedAt: true, createdAt: true, splitEditedAt: true, splitAdminApprovedAt: true, splitDirectorId: true, closedAt: true },
  });
  if (!sub) return { ok: false, error: t("notFound") };
  if (sub.status === SubmissionStatus.Rejected || sub.closedAt) return { ok: false, error: t("alreadyProcessed") };
  if (sub.splitAdminApprovedAt) { revalidatePath("/admin/split-approvals"); return { ok: true }; }

  // The admin step opens once the SD step has landed (explicit or 3-day auto).
  // A sale with no SD assigned has no one to wait on, so the admin may sign off
  // straight away (the sdApprovedAt stamp below records it as a system approval).
  if (sub.splitDirectorId && !isSdApproved(sub).approved) return { ok: false, error: t("pendingSdApproval") };

  // SA-1: compare-and-swap on the splitEditedAt the admin's page rendered.
  const seen = seenAt(seenSplitEditedAt);
  if (seen === "invalid") return { ok: false, error: t("splitChangedReload") };
  const res = await prisma.salesSubmission.updateMany({
    where: { id: submissionId, splitAdminApprovedAt: null, splitEditedAt: seen },
    data: {
      splitAdminApprovedAt: new Date(),
      splitAdminApprovedById: session.user.id,
      // If it was never explicitly SD-approved (3-day auto), record the auto now.
      ...(sub.sdApprovedAt === null ? { sdApprovedAt: new Date() } : {}),
    },
  });
  if (res.count === 0) return (await sameTermsAlready(submissionId, seen, "admin")) ? { ok: true } : { ok: false, error: t("splitChangedReload") };

  if (sub.sdApprovedAt === null) {
    await logAudit({ action: "submission.sd_approved", entityType: "SalesSubmission", entityId: submissionId, actorUserId: null, after: { auto: true } });
  }
  await logAudit({ action: "submission.split_admin_approved", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id });
  revalidatePath("/admin/split-approvals");
  revalidatePath("/portal/quotations");
  return { ok: true };
}

/**
 * B-S6: a Business Admin approves a sale whose split books a commission line below zero
 * (the project owner 2026-09-26: warn, don't block — but require admin approval). Business Admin only
 * (not Accounts), a reason is required, and the approval is bound to (a) the split version
 * the admin's page rendered (SA-1 style CAS on splitEditedAt) and (b) a snapshot of the
 * negative lines as computed NOW, which closeSale re-checks with the rates then in force.
 */
export async function approveSplitException(
  submissionId: string,
  reason: string,
  seenSplitEditedAt: string | null,
  seenLines: SplitBoundViolation[],
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) return { ok: false, error: t("forbidden") };
  const why = (reason ?? "").trim();
  if (why.length < 5 || why.length > 500) return { ok: false, error: t("splitExceptionReasonRequired") };
  const seen = seenAt(seenSplitEditedAt);
  if (seen === "invalid") return { ok: false, error: t("splitChangedReload") };

  const sub = await prisma.salesSubmission.findUnique({
    where: { id: submissionId },
    include: { lineItems: true },
  });
  if (!sub) return { ok: false, error: t("notFound") };
  if (sub.status === SubmissionStatus.Rejected || sub.closedAt) return { ok: false, error: t("alreadyProcessed") };

  const violations = await splitBoundViolations(prisma, {
    salesDate: sub.salesDate, closingAssociateId: sub.closingAssociateId, lines: sub.lineItems,
    associate2Id: sub.associate2Id, associate2ValueType: sub.associate2ValueType, associate2Value: sub.associate2Value,
    associate3Id: sub.associate3Id, associate3ValueType: sub.associate3ValueType, associate3Value: sub.associate3Value,
  });
  if (violations.length === 0) {
    // Nothing negative any more (e.g. rates changed in the associate's favour): clear the flag.
    const cleared = await prisma.salesSubmission.updateMany({ where: { id: submissionId, splitEditedAt: seen }, data: { splitExceptionRequired: false } });
    if (cleared.count) await logAudit({ action: "split.exception_cleared", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id, after: { reason: "no_negative_lines" } });
    revalidatePath("/admin/split-approvals");
    return { ok: true };
  }
  // E1: approve exactly the figures the admin saw. If the recompute differs from what the page
  // rendered (rates or upline eligibility changed since), refuse; the admin must review again.
  if (!Array.isArray(seenLines) || !sameViolations(violations, seenLines)) {
    return { ok: false, error: t("splitFiguresChanged") };
  }

  const res = await prisma.salesSubmission.updateMany({
    where: { id: submissionId, splitEditedAt: seen, closedAt: null, status: { not: SubmissionStatus.Rejected } },
    data: {
      splitExceptionRequired: true,
      splitExceptionApprovedAt: new Date(),
      splitExceptionApprovedById: session.user.id,
      splitExceptionReason: why,
      splitExceptionSnapshot: violations as unknown as Prisma.InputJsonValue,
      splitExceptionVersion: seen,
    },
  });
  if (res.count === 0) return { ok: false, error: t("splitChangedReload") };

  // N4: record both admin actors, so "same person approved the split and the exception" is visible.
  await logAudit({
    action: "split.exception_approved", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id,
    after: { reason: why, snapshot: violations, splitAdminApprovedById: sub.splitAdminApprovedById, sameApproverAsSplit: sub.splitAdminApprovedById === session.user.id },
  });
  revalidatePath("/admin/split-approvals");
  revalidatePath(`/portal/sales/${submissionId}`);
  return { ok: true };
}

/**
 * Reassign a submission's split Sales Director (23-Jul, issue 2 add-on). The SD
 * is defaulted from the closer's team at submission; if it routed to the wrong
 * director (leave, wrong team) a Business Admin can point it at another SD — but
 * only while that SD step is still open (the SD hasn't approved, it hasn't
 * auto-approved, and the sale isn't admin-signed / closed / rejected). Pass null
 * to clear it (falls through to the 3-day auto + admin sign-off).
 */
export async function reassignSplitDirector(submissionId: string, directorId: string | null): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({
    where: { id: submissionId },
    select: { status: true, sdApprovedAt: true, splitAdminApprovedAt: true, closedAt: true },
  });
  if (!sub) return { ok: false, error: t("notFound") };
  if (sub.status === SubmissionStatus.Rejected || sub.closedAt || sub.splitAdminApprovedAt || sub.sdApprovedAt) {
    return { ok: false, error: t("alreadyProcessed") };
  }

  // The target must be an active, approved Sales Director (or null to clear).
  if (directorId) {
    const dir = await prisma.associate.findFirst({
      where: { id: directorId, designation: Designation.SalesDirector, associateStatus: "Active", approvalStatus: "Approved", archivedAt: null },
      select: { id: true },
    });
    if (!dir) return { ok: false, error: t("notADirector") };
  }

  await prisma.salesSubmission.update({ where: { id: submissionId }, data: { splitDirectorId: directorId } });
  await logAudit({ action: "submission.split_director_reassigned", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id, after: { splitDirectorId: directorId } });
  revalidatePath("/admin/split-approvals");
  revalidatePath("/portal/approvals");
  return { ok: true };
}

/**
 * Business Admin approves the rep's right to generate the quotation (23-Jul
 * parallel workflow, flow B). Runs in PARALLEL with split approval — it is NOT
 * gated on the split — after the admin has reviewed the uploaded documents. This
 * only unlocks generation (status → QuotationApproved); the SalesTransaction /
 * commission ledger / invoice are minted later, when the rep closes the sale.
 */
export async function approveQuotation(submissionId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({ where: { id: submissionId }, select: { status: true } });
  if (!sub) return { ok: false, error: t("notFound") };
  if (sub.status !== SubmissionStatus.Submitted) return { ok: false, error: t("alreadyProcessed") };

  await prisma.salesSubmission.update({ where: { id: submissionId }, data: { status: SubmissionStatus.QuotationApproved } });
  await logAudit({ action: "submission.quotation_approved", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id });
  revalidatePath("/admin/quotations");
  revalidatePath("/portal/quotations");
  return { ok: true };
}

/**
 * The closing associate closes the sale (23-Jul parallel workflow, issue 4).
 * Requires BOTH flows complete — quotation generation approved (status
 * QuotationApproved) AND the split fully approved (SD + admin) — plus a signed
 * quotation in the docket. This is where the money artifacts are minted: the
 * SalesTransaction + commission ledger (PendingCollection) and, for a full
 * payment, an OUTSTANDING invoice per company entity; installments get a
 * schedule. Commission becomes payable later, when the admin marks it Paid in
 * Sales & Verify. Idempotent — a sale that already has a transaction is a no-op.
 */
export async function closeSale(submissionId: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({
    where: { id: submissionId },
    include: {
      lineItems: true,
      transaction: { select: { id: true } },
      closingAssociate: {
        include: {
          directUpline: { select: { designation: true } },
          secondUpline: { select: { designation: true } },
        },
      },
      _count: { select: { documents: { where: { kind: SubmissionDocKind.Signed } } } },
    },
  });
  if (!sub) return { ok: false, error: t("notFound") };

  // Only the closing associate (or an admin) may close the sale.
  const isCloser = !!session.user.associateId && session.user.associateId === sub.closingAssociateId;
  if (!isCloser && !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };

  if (sub.transaction) { revalidatePath("/portal/quotations"); return { ok: true }; } // already closed
  if (sub.status !== SubmissionStatus.QuotationApproved) return { ok: false, error: t("quotationNotApproved") };
  if (!splitFullyApproved(sub)) return { ok: false, error: t("splitNotApproved") };
  if (sub._count.documents === 0) return { ok: false, error: t("signedDocRequired") };

  // SEC-6: authoritative bound at closing, with the rates in force on the sales date —
  // a split larger than Net-to-Closer would otherwise book a negative closer line.
  const violations = await splitBoundViolations(prisma, {
    salesDate: sub.salesDate, closingAssociateId: sub.closingAssociateId, lines: sub.lineItems,
    associate2Id: sub.associate2Id, associate2ValueType: sub.associate2ValueType, associate2Value: sub.associate2Value,
    associate3Id: sub.associate3Id, associate3ValueType: sub.associate3ValueType, associate3Value: sub.associate3Value,
  });
  // B-S6: negative lines are allowed only under a split exception that still covers the
  // sale as it books NOW — same split version, and every negative line within the approved
  // snapshot (not new, not deeper, e.g. after a rate change). Otherwise the exception is
  // voided and a fresh Business Admin approval is needed.
  if (violations.length) {
    const approved = sub.splitExceptionApprovedAt !== null
      && (sub.splitExceptionVersion?.getTime() ?? null) === (sub.splitEditedAt?.getTime() ?? null)
      && snapshotCovers(violations, sub.splitExceptionSnapshot as SplitBoundViolation[] | null);
    if (!approved) {
      if (sub.splitExceptionApprovedAt !== null) {
        await prisma.salesSubmission.updateMany({
          where: { id: sub.id, splitExceptionApprovedAt: sub.splitExceptionApprovedAt },
          data: { splitExceptionApprovedAt: null, splitExceptionApprovedById: null, splitExceptionReason: null, splitExceptionSnapshot: Prisma.DbNull, splitExceptionVersion: null, splitExceptionRequired: true },
        });
        await logAudit({ action: "split.exception_voided", entityType: "SalesSubmission", entityId: sub.id, actorUserId: session.user.id, after: { reason: "rates_changed", lines: violations } });
      } else if (!sub.splitExceptionRequired) {
        await prisma.salesSubmission.update({ where: { id: sub.id }, data: { splitExceptionRequired: true } });
      }
      await logAudit({ action: "sale.close_refused", entityType: "SalesSubmission", entityId: sub.id, actorUserId: session.user.id, after: { reason: "splitExceptionRequired", violations } });
      revalidatePath("/admin/split-approvals");
      return { ok: false, error: t("splitExceptionRequired") };
    }
  }

  const closer = sub.closingAssociate;
  const fullPayment = sub.paymentPlan === PaymentPlan.FullPayment;

  const txId = await prisma.$transaction(async (db) => {
    const code = await nextTransactionCode(db);

    const transaction = await db.salesTransaction.create({
      data: {
        transactionCode: code,
        submissionId: sub.id,
        salesDate: sub.salesDate,
        clientName: sub.clientName,
        clientContact: sub.clientContact,
        saleAmount: sub.saleAmount,
        paymentPlan: sub.paymentPlan,
        deposit: sub.deposit,
        installmentCount: sub.installmentCount,
        amountCollected: 0, // nothing collected at closing — collected on mark-Paid
        closingAssociateId: sub.closingAssociateId,
        directUplineId: closer.directUplineId,
        secondUplineId: closer.secondUplineId,
        // Commission is only confirmed at payment (mark-Paid / 3rd installment).
        commissionEligibility: CommissionEligibility.PendingCollection,
        verifiedById: session.user.id,
        verifiedAt: new Date(),
      },
    });

    // attach line items + resolve the structure version active on the sales date
    const byCompany = new Map<string, ReturnType<typeof D>>();
    for (const li of sub.lineItems) {
      const version = await db.commissionStructureVersion.findFirst({
        where: { productCode: li.productCode, effectiveDate: { lte: sub.salesDate } },
        orderBy: { effectiveDate: "desc" },
      });
      await db.saleLineItem.update({
        where: { id: li.id },
        data: { transactionId: transaction.id, structureVersionId: version?.id ?? null },
      });
      byCompany.set(li.companyId, (byCompany.get(li.companyId) ?? D(0)).add(D(li.lineSaleAmount)));
    }

    // Full Payment → one invoice per company entity, OUTSTANDING (unpaid). The
    // admin marks it Paid later in Sales & Verify, which flips commission
    // Eligible. Installments are represented by the schedule below instead.
    if (fullPayment) {
      for (const [companyId, amount] of byCompany) {
        const company = await db.company.update({
          where: { id: companyId },
          data: { invoiceNextSeq: { increment: 1 } },
        });
        const seq = company.invoiceNextSeq - 1;
        const invoiceNumber = `INV-${company.invoicePrefix}-${format(sub.salesDate, "yyyy")}-${String(seq).padStart(5, "0")}`;
        await db.invoice.create({
          data: {
            transactionId: transaction.id,
            companyId,
            invoiceNumber,
            invoiceType: InvoiceType.ComputerGenerated,
            amount,
            status: InvoiceStatus.Outstanding,
          },
        });
      }
    }

    // installment plan + schedule
    if (!fullPayment && sub.installmentCount && sub.installmentCount > 0) {
      const plan = await db.installmentPlan.create({
        data: {
          transactionId: transaction.id,
          totalAmount: sub.saleAmount,
          deposit: sub.deposit ?? 0,
          installmentCount: sub.installmentCount,
        },
      });
      // A-0b: the per-installment amount is rounded to 2dp, so it won't divide
      // the remaining balance exactly (e.g. 10,000/3 = 33.33... x3 = 99.99,
      // 1¢ short). The last installment absorbs whatever rounding leaves over
      // so the schedule always sums to exactly (sale − deposit).
      const remaining = D(sub.saleAmount).sub(D(sub.deposit ?? 0));
      // Deposit row (the project owner, Q9): sequence 0, so Accounts marks it paid with
      // the B-7 payment acknowledgement like any other installment — that's
      // what makes amountCollected (A-0) count the deposit as collected. It is
      // NOT one of the N installments (see eligibility.ts's `sequence > 0`
      // threshold filter) — it's the entry fee, not progress toward the
      // installment count.
      if (D(sub.deposit ?? 0).gt(0)) {
        await db.installmentSchedule.create({ data: { planId: plan.id, sequence: 0, dueAmount: round2(D(sub.deposit ?? 0)), paid: false } });
      }
      const per = round2(remaining.div(sub.installmentCount));
      let running = ZERO;
      for (let i = 1; i <= sub.installmentCount; i++) {
        const dueAmount = i === sub.installmentCount ? round2(remaining.sub(running)) : per;
        running = running.add(dueAmount);
        await db.installmentSchedule.create({ data: { planId: plan.id, sequence: i, dueAmount, paid: false } });
      }
    }

    await db.salesSubmission.update({
      where: { id: sub.id },
      data: { closedAt: new Date(), closedById: session.user.id },
    });
    return transaction.id;
  });

  await runCommission(txId);

  await logAudit({ action: "sale.closed", entityType: "SalesTransaction", entityId: txId, actorUserId: session.user.id, after: { submissionId } });
  revalidatePath("/portal/quotations");
  revalidatePath("/admin/sales/verify");
  revalidatePath("/admin/sales/transactions");
  revalidatePath("/admin/commission");
  revalidatePath("/admin/dashboard");
  return { ok: true };
}

/**
 * Business Admin rejects a submission at the quotation-review stage (16-Jul
 * quotation workflow). Only valid while it is still Submitted; audited.
 */
export async function rejectSubmission(submissionId: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return { ok: false, error: t("forbidden") };

  const sub = await prisma.salesSubmission.findUnique({ where: { id: submissionId }, select: { status: true } });
  if (!sub) return { ok: false, error: t("notFound") };
  if (sub.status !== SubmissionStatus.Submitted) return { ok: false, error: t("alreadyProcessed") };

  await prisma.salesSubmission.update({ where: { id: submissionId }, data: { status: SubmissionStatus.Rejected } });
  await logAudit({ action: "submission.rejected", entityType: "SalesSubmission", entityId: submissionId, actorUserId: session.user.id, after: { reason: reason?.trim() || null } });
  revalidatePath("/admin/quotations");
  return { ok: true };
}
