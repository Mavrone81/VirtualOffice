"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { Prisma, ApprovalStatus, AssociateStatus, Designation, PaymentMethod, AppRole } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole, isFullAdmin, downlineIds, roleForDesignation } from "@/lib/rbac";
import { encryptPII } from "@/lib/crypto";
import { auditTx, AuditWriteError } from "@/lib/audit";
import { maskedPayee } from "./payee-audit";
import { decryptPiiAudited, PiiAuditUnavailableError, type PiiField } from "@/server/pii";
import { generateTempPassword } from "@/lib/temp-password";
import { validate } from "@/lib/validate";
import { nextAssociateCode } from "@/lib/associate-code";
import { newAssociateSchema, updateAssociateSchema } from "@/lib/schemas";
import { putObject } from "@/lib/storage";
import { assertDocumentUpload } from "@/lib/file-type";
import { fileSignedAgreement } from "@/server/recruitment/file-signed-agreement";

async function requireAdmin() {
  const session = await auth();
  if (!session || !isAdminRole(session.user.role)) return null;
  return session;
}

/**
 * Reveal an associate's masked PII (NRIC / bank account) to a Business Admin on
 * demand. Decrypt happens only on this explicit click and is recorded in the
 * audit trail (`decrypt_pii`, with the field + actor) — not on every page view.
 */
export async function revealAssociatePii(
  associateId: string,
  field: PiiField,
): Promise<{ ok: boolean; value?: string; error?: string }> {
  const t = await getTranslations("errors");
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) return { ok: false, error: t("forbidden") };

  const a = await prisma.associate.findUnique({
    where: { id: associateId },
    select: { nric: true, bankAccountNumber: true },
  });
  if (!a) return { ok: false, error: t("notFound") };

  const blob = field === "nric" ? a.nric : a.bankAccountNumber;
  let value: string | null;
  try {
    value = await decryptPiiAudited({ blob, field, subjectType: "Associate", subjectId: associateId, actorUserId: session.user.id });
  } catch (e) {
    // Audit-before-reveal: no audit record, no plaintext.
    if (e instanceof PiiAuditUnavailableError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  if (value == null) return { ok: false, error: t("notFound") };
  return { ok: true, value };
}

// app_role provisioned from org designation (16-Jul: each sales tier has its own role; cf. roleForDesignation in lib/rbac.ts)
// Archive and hard-delete both require the associate to be out of service first
// (the owner's deactivate-before-delete rule). BOTH deactivated states count.
// Inactive is where a never-approved associate starts; Suspended is the only
// deactivated state the admin UI can actually reach for someone who HAS been
// approved, because "Suspend" is the only control offered there and it does not
// write Inactive. Accepting Inactive alone therefore made delete unreachable for
// every approved associate — the opposite of the rule it was meant to enforce.
// Terminated is deliberately excluded: that is an end state for someone who did
// serve, not an unused record. This gates LIFECYCLE only; every "never used"
// check below is unchanged and is what actually protects history.
const DEACTIVATED: AssociateStatus[] = [AssociateStatus.Inactive, AssociateStatus.Suspended];

const ROLE_FOR_DESIGNATION: Record<Designation, AppRole> = {
  // A Managing Director is a sales DESIGNATION the owner added for the
  // managing-director cut (2026-10-07); AppRole has no matching value and the
  // owner asked for a designation and a cut, not an access change. Mapped to
  // the highest existing sales role so permissions are unchanged in substance.
  ManagingDirector: AppRole.SalesDirector,
  SalesDirector: AppRole.SalesDirector,
  SalesManager: AppRole.SalesManager,
  SalesAssistantManager: AppRole.SalesAssistantManager,
  SalesAssociate: AppRole.SalesAssociate,
};


export type NewAssociateInput = {
  fullName: string;
  businessName?: string;
  mobileNumber?: string;
  email?: string;
  nric?: string;
  dateOfBirth?: string;
  designation: Designation;
  directUplineCode?: string;
  secondUplineCode?: string;
  teamName?: string;
  recruitingManager?: string;
  paymentMethod?: "PayNow" | "Bank Transfer";
  paynowNumber?: string;
  bankName?: string;
  bankAccountNumber?: string;
};


// The form renders optional fields as `value={f.x ?? ""}`, so clearing one
// after typing sends "" rather than undefined. newAssociateSchema treats
// these as optional-but-non-empty-when-present (e.g. nric/email), so "" would
// otherwise be wrongly rejected as invalidInput even though the user's intent
// was "leave this blank" — normalize before validating.
const BLANKABLE_KEYS: (keyof NewAssociateInput)[] = [
  "businessName", "mobileNumber", "email", "nric", "dateOfBirth",
  "directUplineCode", "secondUplineCode", "teamName", "recruitingManager", "paymentMethod",
  "paynowNumber", "bankName", "bankAccountNumber",
];
function blankToUndefined(input: NewAssociateInput): NewAssociateInput {
  const out = { ...input };
  for (const k of BLANKABLE_KEYS) {
    if (out[k] === "") delete out[k];
  }
  return out;
}

export async function createAssociate(input: NewAssociateInput): Promise<{ ok: boolean; error?: string; code?: string }> {
  const t = await getTranslations("errors");
  const v = validate(newAssociateSchema, blankToUndefined(input));
  if (!v.ok) return { ok: false, error: t("invalidInput") };
  const validInput = v.data;
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  const actor = admin.user.id;

  const directUpline = validInput.directUplineCode
    ? await prisma.associate.findUnique({ where: { associateCode: validInput.directUplineCode } })
    : null;
  if (validInput.directUplineCode && !directUpline) return { ok: false, error: t("directUplineNotFound") };

  // Second upline defaults to the direct upline's own upline (auto-derived, the
  // usual chain) but the admin may override it. Overrides are positional: the
  // direct upline earns the Tier-1 override, the second upline the Tier-2 one,
  // regardless of either's designation — so both must be settable.
  let secondUplineId: string | null;
  if (validInput.secondUplineCode) {
    const secondUpline = await prisma.associate.findUnique({ where: { associateCode: validInput.secondUplineCode } });
    if (!secondUpline) return { ok: false, error: t("secondUplineNotFound") };
    if (directUpline && secondUpline.id === directUpline.id) return { ok: false, error: t("uplinesMustDiffer") };
    secondUplineId = secondUpline.id;
  } else {
    secondUplineId = directUpline?.directUplineId ?? null; // auto-derive default
  }

  const code = await nextAssociateCode();
  // Tier A: a new payee (and their commission chain) is recorded with the row.
  try {
    await prisma.$transaction(async (db) => {
  const created = await db.associate.create({
    data: {
      associateCode: code,
      fullName: validInput.fullName.trim(),
      businessName: validInput.businessName?.trim() || null,
      mobileNumber: validInput.mobileNumber?.trim() || null,
      email: validInput.email?.trim() || null,
      nric: validInput.nric ? encryptPII(validInput.nric.trim()) : null,
      dateOfBirth: validInput.dateOfBirth ? new Date(validInput.dateOfBirth) : null,
      designation: validInput.designation,
      directUplineId: directUpline?.id ?? null,
      secondUplineId,
      recruitingManager: validInput.recruitingManager?.trim() || null,
      teamName: validInput.teamName?.trim() || null,
      paymentMethod: validInput.paymentMethod === "Bank Transfer" ? PaymentMethod.BankTransfer : validInput.paymentMethod === "PayNow" ? PaymentMethod.PayNow : null,
      paynowNumber: validInput.paynowNumber?.trim() || null,
      bankName: validInput.bankName?.trim() || null,
      bankAccountNumber: validInput.bankAccountNumber ? encryptPII(validInput.bankAccountNumber.trim()) : null,
      approvalStatus: ApprovalStatus.Pending,
      associateStatus: AssociateStatus.Inactive,
    },
  });
  await auditTx(db, {
    action: "associate.created", entityType: "Associate", entityId: created.id, actorUserId: actor,
    after: { associateCode: code, designation: created.designation, directUplineId: created.directUplineId, secondUplineId: created.secondUplineId, payee: maskedPayee(created) },
  });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/associates");
  return { ok: true, code };
}

export type UpdateAssociateInput = {
  fullName: string;
  businessName?: string;
  mobileNumber?: string;
  email?: string;
  nric?: string;
  dateOfBirth?: string;
  joinDate?: string;
  designation: Designation;
  teamName?: string;
  recruitingManager?: string;
  paymentMethod?: "PayNow" | "Bank Transfer";
  paynowNumber?: string;
  bankName?: string;
  bankAccountNumber?: string;
};

// Same "" -> undefined normalization as create, plus joinDate. nric and
// bankAccountNumber are handled as keep-if-blank (never prefilled), so a blank
// value must NOT overwrite the stored ciphertext.
const UPDATE_BLANKABLE: (keyof UpdateAssociateInput)[] = [
  "businessName", "mobileNumber", "email", "nric", "dateOfBirth", "joinDate",
  "teamName", "recruitingManager", "paymentMethod", "paynowNumber", "bankName", "bankAccountNumber",
];

/**
 * Edit an existing associate's core record (admin). Uplines are intentionally
 * NOT here — they have cycle guards in {@link updateAssociateUplines}. The
 * linked user's login email and app_role are also left untouched (account/role
 * management is separate). nric / bankAccountNumber update only when a new value
 * is supplied; a blank field keeps the existing encrypted value.
 */
export async function updateAssociate(
  id: string,
  input: UpdateAssociateInput,
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  const actor = admin.user.id;

  const normalized = { ...input };
  for (const k of UPDATE_BLANKABLE) if (normalized[k] === "") delete normalized[k];

  const parsed = validate(updateAssociateSchema, normalized);
  if (!parsed.ok) return { ok: false, error: t("invalidInput") };
  const v = parsed.data;

  const existing = await prisma.associate.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { ok: false, error: t("notFound") };
  const PAYEE = { paymentMethod: true, bankName: true, paynowNumber: true, bankAccountNumber: true, designation: true } as const;

  const data: Record<string, unknown> = {
    fullName: v.fullName.trim(),
    businessName: v.businessName?.trim() || null,
    mobileNumber: v.mobileNumber?.trim() || null,
    email: v.email?.trim() || null,
    dateOfBirth: v.dateOfBirth ? new Date(v.dateOfBirth) : null,
    joinDate: v.joinDate ? new Date(v.joinDate) : null,
    designation: v.designation,
    teamName: v.teamName?.trim() || null,
    recruitingManager: v.recruitingManager?.trim() || null,
    paymentMethod:
      v.paymentMethod === "Bank Transfer" ? PaymentMethod.BankTransfer
      : v.paymentMethod === "PayNow" ? PaymentMethod.PayNow : null,
    paynowNumber: v.paynowNumber?.trim() || null,
    bankName: v.bankName?.trim() || null,
  };
  // keep-if-blank PII: only overwrite when a fresh value was typed
  if (v.nric) data.nric = encryptPII(v.nric.trim());
  if (v.bankAccountNumber) data.bankAccountNumber = encryptPII(v.bankAccountNumber.trim());

  // Tier A: payee details (masked) and designation (commission input) are
  // recorded with the edit, in the same transaction, before/after read under it.
  try {
    await prisma.$transaction(async (db) => {
      const before = await db.associate.findUniqueOrThrow({ where: { id }, select: PAYEE });
      const after = await db.associate.update({ where: { id }, data, select: PAYEE });
      // The login role is DERIVED from the designation (roleForDesignation), and
      // recruitment/nav/permissions check the role — so a promotion that only
      // changed the designation left the old role in force (Bug 001, 28 Sep:
      // promoted to Sales Manager, still couldn't recruit). Keep them in step.
      // Office roles (Admin/Accounts) are assigned, never derived: left alone.
      let roleChange: { from: string; to: string } | null = null;
      if (before.designation !== after.designation) {
        const user = await db.user.findUnique({ where: { associateId: id }, select: { id: true, role: true } });
        const to = roleForDesignation(after.designation);
        if (user && !isAdminRole(user.role) && user.role !== to) {
          await db.user.update({ where: { id: user.id }, data: { role: to } });
          roleChange = { from: user.role, to };
        }
      }
      await auditTx(db, {
        action: "associate.updated", entityType: "Associate", entityId: id, actorUserId: actor,
        before: { designation: before.designation, payee: maskedPayee(before), ...(roleChange ? { role: roleChange.from } : {}) },
        after: { designation: after.designation, payee: maskedPayee(after), nricChanged: !!v.nric, bankAccountChanged: !!v.bankAccountNumber, ...(roleChange ? { role: roleChange.to } : {}) },
      });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/associates");
  revalidatePath(`/admin/associates/${id}`);
  return { ok: true };
}

/**
 * Change an existing associate's direct + second upline (16-Jul §7). Overrides
 * are positional (direct = Tier-1, second = Tier-2), so an admin must be able to
 * set both. Pass a code to set, or null/blank to clear. Guards self-reference,
 * direct==second, and picking one of this associate's own downline (which would
 * create a cycle). Only affects FUTURE verifications — past transactions keep
 * the upline they snapshotted at verify time.
 */
export async function updateAssociateUplines(
  id: string,
  directUplineCode: string | null,
  secondUplineCode: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };

  const associate = await prisma.associate.findUnique({
    where: { id },
    select: { directUplineId: true, secondUplineId: true },
  });
  if (!associate) return { ok: false, error: t("notFound") };

  async function resolveCode(codeVal: string | null, notFoundKey: string) {
    const trimmed = codeVal?.trim();
    if (!trimmed) return { ok: true as const, id: null };
    const up = await prisma.associate.findUnique({ where: { associateCode: trimmed }, select: { id: true } });
    if (!up) return { ok: false as const, key: notFoundKey };
    return { ok: true as const, id: up.id };
  }

  const dir = await resolveCode(directUplineCode, "directUplineNotFound");
  if (!dir.ok) return { ok: false, error: t(dir.key) };
  const sec = await resolveCode(secondUplineCode, "secondUplineNotFound");
  if (!sec.ok) return { ok: false, error: t(sec.key) };

  if (dir.id === id || sec.id === id) return { ok: false, error: t("uplineCannotBeSelf") };
  if (dir.id && sec.id && dir.id === sec.id) return { ok: false, error: t("uplinesMustDiffer") };

  // Cycle guard: an upline may not be one of this associate's own descendants.
  const descendants = new Set(await downlineIds(id));
  if ((dir.id && descendants.has(dir.id)) || (sec.id && descendants.has(sec.id))) {
    return { ok: false, error: t("uplineCannotBeDownline") };
  }

  // Tier A (commission input: override recipients) — change + record together.
  try {
    await prisma.$transaction(async (db) => {
      await db.associate.update({ where: { id }, data: { directUplineId: dir.id, secondUplineId: sec.id } });
      await auditTx(db, {
        action: "associate.uplines.updated",
        entityType: "Associate",
        entityId: id,
        actorUserId: admin.user.id,
        before: { directUplineId: associate.directUplineId, secondUplineId: associate.secondUplineId },
        after: { directUplineId: dir.id, secondUplineId: sec.id },
      });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath(`/admin/associates/${id}`);
  revalidatePath("/admin/associates");
  return { ok: true };
}

/** Approve/Reject/Incomplete. On Approve → activate + provision a login if none. */
export async function setApprovalStatus(
  id: string,
  status: "Approved" | "Rejected" | "Incomplete",
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  const actor = admin.user.id;
  const a = await prisma.associate.findUnique({ where: { id }, include: { user: true } });
  if (!a) return { ok: false, error: t("notFound") };

  const approvalStatus = ApprovalStatus[status];
  const pwHash = status === "Approved" && !a.user && a.email ? await hash(generateTempPassword()) : null;
  try {
  await prisma.$transaction(async (db) => {
  await db.associate.update({
    where: { id },
    data: {
      approvalStatus,
      associateStatus: status === "Approved" ? AssociateStatus.Active : a.associateStatus,
    },
  });

  // provision a login on first approval if the associate has an email and no user
  let provisioned: { userId: string; role: string } | null = null;
  if (pwHash && a.email) {
    const user = await db.user.create({
      data: { email: a.email, passwordHash: pwHash, role: ROLE_FOR_DESIGNATION[a.designation], associateId: a.id, mustResetPassword: true },
    });
    await db.pFile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, associateId: a.id } });
    provisioned = { userId: user.id, role: user.role };
  }
  // Tier A: approval, and any login/role it grants, recorded together.
  await auditTx(db, { action: `associate.approval.${approvalStatus}`, entityType: "Associate", entityId: id, actorUserId: actor, before: { approvalStatus: a.approvalStatus }, after: { approvalStatus, ...(provisioned ? { loginProvisioned: provisioned } : {}) } });
  });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/associates");
  revalidatePath("/admin/dashboard");
  return { ok: true };
}

export async function setAssociateStatus(
  id: string,
  status: "Active" | "Suspended" | "Terminated" | "Inactive",
): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  const actor = admin.user.id;
  // Tier A: status (and login enablement) recorded in the same transaction.
  try {
    await prisma.$transaction(async (db) => {
      const before = await db.associate.findUnique({ where: { id }, select: { associateStatus: true } });
      await db.associate.update({ where: { id }, data: { associateStatus: AssociateStatus[status] } });
      // reflect login enablement
      const a = await db.associate.findUnique({ where: { id }, include: { user: true } });
      if (a?.user) {
        await db.user.update({ where: { id: a.user.id }, data: { isActive: status === "Active" } });
      }
      await auditTx(db, { action: `associate.status.${status}`, entityType: "Associate", entityId: id, actorUserId: actor, before: { associateStatus: before?.associateStatus ?? null }, after: { associateStatus: status, loginActive: a?.user ? status === "Active" : null } });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/associates");
  return { ok: true };
}

// Thrown inside the transaction below when the CAS below finds the row no
// longer matches `signedAgreementFileKey: null` — a concurrent call already
// filed one first. Distinguishes "lost the race" from an AuditWriteError so
// each maps to its own message.
class AlreadyFiled extends Error {}

/**
 * C-4: admin uploads an Associate Agreement signed OFFLINE (paper, outside the
 * portal) — for an associate who never e-signed through onboarding. This
 * NEVER replaces a portal-signed agreement: refused outright when one already
 * exists (associate.signedAgreementFileKey set), so the portal-signed copy is
 * never silently overwritten by a later offline upload. Files through the
 * SAME fileSignedAgreement() helper approveCandidate uses, so "what counts as
 * filed" can never diverge between the two paths.
 *
 * The object write stays OUTSIDE the transaction, deliberately, same as the
 * signed-agreement PDF write in server/agreements/actions.ts (ADR-0001/N2):
 * an orphaned object in storage with no row pointing at it is acceptable
 * (nothing reads storage without a key from the DB first); don't make the
 * object write transactional.
 *
 * The findUnique-then-update shape would be a TOCTOU window — two concurrent
 * calls could both read signedAgreementFileKey as null before either writes.
 * Closed with an atomic compare-and-set instead: `updateMany` matched on
 * `signedAgreementFileKey: null` in its own `where`, so only one of two
 * concurrent calls can match; the loser's count is 0, not an exception, and
 * is refused with the same message a sequential second call gets.
 */
export async function uploadOfflineSignedAgreement(associateId: string, file: File): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };

  const a = await prisma.associate.findUnique({ where: { id: associateId }, include: { user: true } });
  if (!a) return { ok: false, error: t("notFound") };
  if (a.signedAgreementFileKey) return { ok: false, error: t("agreementAlreadyOnFile") };
  if (!a.user) return { ok: false, error: t("noLoginProvisioned") };

  if (!file || file.size === 0) return { ok: false, error: t("fileRequired") };
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    assertDocumentUpload(bytes, file.name);
  } catch {
    return { ok: false, error: t("invalidFileType") };
  }

  const ext = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) ?? "pdf";
  const key = `associates/${associateId}/offline-signed-agreement-${randomUUID()}.${ext}`;
  await putObject(key, bytes);

  try {
    await prisma.$transaction(async (tx) => {
      const cas = await tx.associate.updateMany({ where: { id: associateId, signedAgreementFileKey: null }, data: { signedAgreementFileKey: key } });
      if (cas.count === 0) throw new AlreadyFiled();
      await fileSignedAgreement(tx, a.user!.id, associateId, key, admin.user.id);
      await auditTx(tx, {
        action: "associate.agreement_uploaded_offline", entityType: "Associate", entityId: associateId,
        actorUserId: admin.user.id, after: { fileKey: key },
      });
    });
  } catch (e) {
    if (e instanceof AlreadyFiled) return { ok: false, error: t("agreementAlreadyOnFile") };
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }

  revalidatePath("/admin/associates");
  revalidatePath("/portal/pfile");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Archive / delete ("Delete associate after deactivated")
//
// Two distinct operations, not one — an admin reaching for "remove this
// person" should land on archive; delete is the separate, narrow path.
//
// ARCHIVE is the normal path: sets archivedAt (same shape as
// archiveMarketingCollection in server/marketing/actions.ts — a toggle, not a
// one-way action) on an Inactive associate. Every existing `archivedAt: null`
// read filter (lib/rbac.ts downlineIds/directRecruits, server/sales/actions.ts,
// server/recruitment/team-dashboard.ts, and six admin/portal page queries)
// then excludes them automatically — nothing about those filters changes here;
// this is the first code path that ever writes a non-null value for them to
// react to. History (ledger lines, submissions, transactions, payouts) is
// untouched and reversible by archiving false.
//
// HARD DELETE is the narrow path, for an associate that has never been used.
// Refused unless the associate is Inactive AND none of a specific list of
// relations are non-empty. Every count below runs INSIDE the same transaction
// as the delete, not before it — an associate that passes the check and
// acquires history a moment later must not be deleted.
// ---------------------------------------------------------------------------

/** Carries which specific condition blocked a delete, with its count, so the
 *  caller returns a named reason ("has 3 associates reporting to them") rather
 *  than a generic failure. Thrown inside the transaction, caught outside it. */
class AssociateInUse extends Error {
  constructor(
    public readonly reasonKey: string,
    public readonly count: number,
  ) {
    super(`associate in use: ${reasonKey} (${count})`);
  }
}

/**
 * Archive (or restore) an associate. Archiving requires Inactive — the
 * owner's deactivate-first rule applies to BOTH operations below, not only
 * delete. Restoring (archived=false) has no precondition, same as the
 * marketing toggle this mirrors.
 */
export async function archiveAssociate(id: string, archived: boolean): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  const actor = admin.user.id;

  try {
    await prisma.$transaction(async (db) => {
      const existing = await db.associate.findUnique({ where: { id }, select: { associateStatus: true, archivedAt: true } });
      if (!existing) throw new AssociateInUse("notFound", 0);
      if (archived && !DEACTIVATED.includes(existing.associateStatus)) {
        throw new AssociateInUse("notInactive", 0);
      }
      await db.associate.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
      await auditTx(db, {
        action: archived ? "associate.archived" : "associate.unarchived",
        entityType: "Associate",
        entityId: id,
        actorUserId: actor,
        before: { archivedAt: existing.archivedAt },
        after: { archivedAt: archived ? "set" : null },
      });
    });
  } catch (e) {
    if (e instanceof AssociateInUse) {
      if (e.reasonKey === "notFound") return { ok: false, error: t("notFound") };
      return { ok: false, error: t("associateNotInactive") };
    }
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/associates");
  revalidatePath(`/admin/associates/${id}`);
  revalidatePath("/admin/teams");
  return { ok: true };
}

/**
 * Permanently remove an associate that has never been used. Refuses unless
 * ALL hold: Inactive, zero sales/commission/payout/voucher/quotation/vendor
 * history, zero assigned-or-owned documents, zero downline (either tier), not
 * an intended upline on any candidate, and not a converted-from-candidate
 * record. Every count runs inside the same transaction as the delete.
 *
 * Also defensively clears (never deletes) Candidate.invitedById/reviewedById
 * where they point at this associate's own user account — not part of the
 * owner's blocking-condition list, added because leaving them would hit an
 * FK constraint on the user delete below for an edge case the spec doesn't
 * name (an Inactive associate whose account invited/reviewed candidates
 * while previously Active). Flagged in the delivery report, not silently
 * folded in as if it were asked for.
 *
 * Does NOT rely on a schema-level cascade — every deletion below is explicit,
 * in FK-safe order, inside one transaction with the blocking-condition counts.
 */
export async function deleteAssociate(id: string): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: t("forbidden") };
  const actor = admin.user.id;

  try {
    await prisma.$transaction(async (db) => {
      const a = await db.associate.findUnique({
        where: { id },
        select: { associateCode: true, fullName: true, associateStatus: true, user: { select: { id: true } } },
      });
      if (!a) throw new AssociateInUse("notFound", 0);
      if (!DEACTIVATED.includes(a.associateStatus)) throw new AssociateInUse("notInactive", 0);

      const [
        submissions,
        transactions,
        ledgerLines,
        payouts,
        vouchers,
        quotations,
        vendorReferrals,
        ownedDocs,
        assignedDocs,
        directDownline,
        secondDownline,
        intendedUpline,
        convertedFrom,
      ] = await Promise.all([
        db.salesSubmission.count({ where: { closingAssociateId: id } }),
        db.salesTransaction.count({ where: { closingAssociateId: id } }),
        db.commissionLedger.count({ where: { associateId: id } }),
        db.monthlyPayout.count({ where: { associateId: id } }),
        db.paymentVoucher.count({ where: { associateId: id } }),
        db.quotation.count({ where: { associateId: id } }),
        db.vendorReferral.count({ where: { submittedByAssociateId: id } }),
        db.document.count({ where: { ownerAssociateId: id } }),
        db.document.count({ where: { assignedAssociateId: id } }),
        db.associate.count({ where: { directUplineId: id } }),
        db.associate.count({ where: { secondUplineId: id } }),
        db.candidate.count({ where: { intendedDirectUplineId: id } }),
        db.candidate.count({ where: { convertedAssociateId: id } }),
      ]);

      const salesHistory = submissions + transactions;
      if (salesHistory > 0) throw new AssociateInUse("salesHistory", salesHistory);
      if (ledgerLines > 0) throw new AssociateInUse("commissionHistory", ledgerLines);
      if (payouts > 0) throw new AssociateInUse("payoutHistory", payouts);
      if (vouchers > 0) throw new AssociateInUse("paymentVouchers", vouchers);
      if (quotations > 0) throw new AssociateInUse("quotations", quotations);
      if (vendorReferrals > 0) throw new AssociateInUse("vendorReferrals", vendorReferrals);
      const documents = ownedDocs + assignedDocs;
      if (documents > 0) throw new AssociateInUse("documents", documents);
      const downline = directDownline + secondDownline;
      if (downline > 0) throw new AssociateInUse("downline", downline);
      if (intendedUpline > 0) throw new AssociateInUse("intendedUpline", intendedUpline);
      if (convertedFrom > 0) throw new AssociateInUse("convertedFromCandidate", convertedFrom);

      // Never used — safe to remove. FK-safe order: documents before their
      // parent row, the user's own records before the user, the user before
      // the associate (associate.user is optional so order here doesn't
      // strictly require it, but keeping it last matches "the associate row
      // is the final truth" in every other action in this file).
      const userId = a.user?.id ?? null;
      if (userId) {
        await db.pFileDocument.deleteMany({ where: { pFile: { userId } } });
        await db.pFile.deleteMany({ where: { userId } });
        await db.nameCard.deleteMany({ where: { userId } });
        await db.noticeRead.deleteMany({ where: { userId } });
        // Defensive, not part of the owner's spec — see function doc comment.
        await db.candidate.updateMany({ where: { invitedById: userId }, data: { invitedById: null } });
        await db.candidate.updateMany({ where: { reviewedById: userId }, data: { reviewedById: null } });
      }
      await db.salesQuota.deleteMany({ where: { associateId: id } });
      await db.teamMember.deleteMany({ where: { associateId: id } });
      if (userId) await db.user.delete({ where: { id: userId } });
      await db.associate.delete({ where: { id } });

      await auditTx(db, {
        action: "associate.deleted",
        entityType: "Associate",
        entityId: id,
        actorUserId: actor,
        before: { associateCode: a.associateCode, fullName: a.fullName },
      });
    });
  } catch (e) {
    if (e instanceof AssociateInUse) {
      switch (e.reasonKey) {
        case "notFound": return { ok: false, error: t("notFound") };
        case "notInactive": return { ok: false, error: t("associateNotInactive") };
        case "salesHistory": return { ok: false, error: t("associateHasSalesHistory", { count: e.count }) };
        case "commissionHistory": return { ok: false, error: t("associateHasCommissionHistory", { count: e.count }) };
        case "payoutHistory": return { ok: false, error: t("associateHasPayoutHistory", { count: e.count }) };
        case "paymentVouchers": return { ok: false, error: t("associateHasPaymentVouchers", { count: e.count }) };
        case "quotations": return { ok: false, error: t("associateHasQuotations", { count: e.count }) };
        case "vendorReferrals": return { ok: false, error: t("associateHasVendorReferrals", { count: e.count }) };
        case "documents": return { ok: false, error: t("associateHasDocuments", { count: e.count }) };
        case "downline": return { ok: false, error: t("associateHasDownline", { count: e.count }) };
        case "intendedUpline": return { ok: false, error: t("associateIsIntendedUpline", { count: e.count }) };
        case "convertedFromCandidate": return { ok: false, error: t("associateIsConvertedCandidate") };
      }
    }
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    // Safety net, same shape as deleteDocument (server/documents/actions.ts,
    // release/doc-delete-ordering): a reference this function's explicit
    // checks above didn't anticipate still refuses as a named error, not a
    // raw 500 — the explicit checks above exist for a BETTER message, not as
    // the only thing standing between this call and a DB exception.
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")) {
      return { ok: false, error: t("associateStillReferenced") };
    }
    throw e;
  }
  revalidatePath("/admin/associates");
  revalidatePath("/admin/teams");
  return { ok: true };
}
