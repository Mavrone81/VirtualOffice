"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { ApprovalStatus, AssociateStatus, Designation, PaymentMethod, AppRole } from "@prisma/client";
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
const ROLE_FOR_DESIGNATION: Record<Designation, AppRole> = {
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

const SEQ_PREFIX = "EN";
const SEQ_RE = /^EN\d+$/;

/** Next code in the `EN####` sequence.
 *
 *  🔴 `associateCode` is a free-text `@unique` column with NO format constraint, so
 *  an unscoped `orderBy: { associateCode: "desc" }` returns whatever sorts highest
 *  LEXICOGRAPHICALLY — any code above "EN…" wins. The previous implementation then
 *  stripped non-digits from that code with `replace(/\D/g, "")`, so a single row
 *  like "MYCOM-A1" yielded "1", returned EN0002, and collided with an existing
 *  associate on the unique index. Observed live: EN0102 was the real high-water
 *  mark while this returned EN0002, and every approval failed.
 *
 *  This is an AVAILABILITY defect, not a test-fixture problem: nothing stops a
 *  non-"EN" code existing in production — a manual entry, an import, a second
 *  company prefix — and the first one that sorts above the sequence breaks
 *  associate creation until a human diagnoses a unique-constraint error pointing
 *  at the wrong thing.
 *
 *  So: scope the query to the sequence's own prefix, and because `startsWith`
 *  narrows but cannot enforce the SHAPE ("ENX-1" still sorts in), take the highest
 *  row that matches the sequence exactly. The numeric part is read by `slice` past
 *  the prefix rather than by stripping non-digits, so a malformed code can never
 *  contribute digits to the result. */
async function nextAssociateCode(): Promise<string> {
  // No `orderBy` and no `take`. A FORMAT SCOPE IS NOT AN ORDERING: these are two
  // separate properties and the sequence needs both.
  //
  // 🔴 `orderBy: { associateCode: "desc" }` is TEXT order, so "EN10000" sorts BELOW
  // "EN9999" ('1' < '9' at the third character). Once EN10000 exists the text
  // maximum is stuck at EN9999 forever, this proposes EN10000 on every call, and
  // every associate creation from the 10,000th onward fails on the unique index —
  // permanently, with no self-correction. Harmless at ten rows, free to prevent
  // now, and expensive to discover at ten thousand.
  //
  // Prisma cannot order by a computed expression, so the numeric maximum is taken
  // in application code over the sequence's own rows. The payload is one short
  // column; at any plausible associate count that is negligible, and the real
  // long-term answer is a dedicated sequence rather than a counter derived from a
  // display column.
  const rows = await prisma.associate.findMany({
    where: { associateCode: { startsWith: SEQ_PREFIX } },
    select: { associateCode: true },
  });
  const numbers = rows
    .filter((r) => SEQ_RE.test(r.associateCode))
    .map((r) => parseInt(r.associateCode.slice(SEQ_PREFIX.length), 10));
  // Rows exist under the prefix but none is a valid sequence code: the sequence
  // cannot be derived. Fail loudly rather than restart from 1 and collide.
  if (rows.length > 0 && numbers.length === 0) {
    throw new Error(
      `nextAssociateCode: ${rows.length} ${SEQ_PREFIX}-prefixed codes exist but none match ${SEQ_RE}; cannot derive the next code`,
    );
  }
  const n = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `${SEQ_PREFIX}${String(n).padStart(4, "0")}`;
}

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
