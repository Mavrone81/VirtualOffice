"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFullAdmin } from "@/lib/rbac";
import { auditTx, AuditWriteError } from "@/lib/audit";
import { putObject, deleteObject } from "@/lib/storage";
import { assertUpload } from "@/lib/file-type";
import { cleanCompanyDetails, type CompanyDetailsInput } from "@/lib/company-identity";

const MAX_SIGNATURE_BYTES = 5_000_000;

// CR-0001: the Company Data tab's one row (see prisma/schema.prisma's
// CompanySignatory for why this is a singleton, not a new Company field).
// Stricter than isAdminRole — Accounts can see most admin screens but this
// identity feeds every future associate's signed agreement.
async function requireFullAdmin() {
  const session = await auth();
  if (!session || !isFullAdmin(session.user.role)) return null;
  return session;
}

type CompanySignatoryView = { signatoryName: string | null; signatureFileKey: string | null; updatedAt: Date | null };

function asView(row: { signatoryName: string; signatureFileKey: string | null; updatedAt: Date } | null): CompanySignatoryView {
  return row
    ? { signatoryName: row.signatoryName, signatureFileKey: row.signatureFileKey, updatedAt: row.updatedAt }
    : { signatoryName: null, signatureFileKey: null, updatedAt: null };
}

/** Current signatory shown on the Company Data tab — never the snapshot on a
 *  signed agreement, which lives on Candidate/Associate instead and is never
 *  re-read from here once set. */
export async function getCompanySignatory(): Promise<{ ok: boolean; error?: string; data?: CompanySignatoryView }> {
  const t = await getTranslations("errors");
  const session = await requireFullAdmin();
  if (!session) return { ok: false, error: t("forbidden") };
  const row = await prisma.companySignatory.findUnique({ where: { singleton: true } });
  return { ok: true, data: asView(row) };
}

/**
 * Update the signatory name and/or signature. Either field may be omitted to
 * leave it unchanged; pass `signatureFile: null` explicitly to clear the
 * signature without replacing it. Does NOT touch any already-signed
 * agreement — those carry their own at-signing snapshot
 * (companySignatoryNameAtSigning / companySignatureFileKeyAtSigning on
 * Candidate/Associate), captured once in server/recruitment/actions.ts and
 * never re-read from this table afterward.
 */
export async function updateCompanySignatory(input: {
  signatoryName?: string;
  signatureFile?: File | null;
}): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireFullAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const name = input.signatoryName?.trim();
  if (name !== undefined && name.length === 0) return { ok: false, error: t("signatoryNameRequired") };

  let newKey: string | undefined;
  let uploadedKey: string | null = null;
  if (input.signatureFile) {
    if (input.signatureFile.size === 0) return { ok: false, error: t("fileRequired") };
    if (input.signatureFile.size > MAX_SIGNATURE_BYTES) return { ok: false, error: t("fileTooLarge") };
    const bytes = new Uint8Array(await input.signatureFile.arrayBuffer());
    try {
      assertUpload(bytes, ["png"]);
    } catch {
      return { ok: false, error: t("invalidFileType") };
    }
    // A new key every time, never reused — the same "never overwrite a
    // stored file in place" rule the ashes/associate signature uploads
    // follow, so a stale CDN/cache copy of the old file can't ever be served
    // under the new one's key.
    newKey = `companies/signatory/${randomUUID()}-signature.png`;
    await putObject(newKey, Buffer.from(bytes));
    uploadedKey = newKey;
  } else if (input.signatureFile === null) {
    newKey = undefined; // cleared below via explicit null in the upsert data
  }

  const existing = await prisma.companySignatory.findUnique({ where: { singleton: true } });
  const before = existing
    ? { signatoryName: existing.signatoryName, signatureFileKey: existing.signatureFileKey }
    : { signatoryName: null, signatureFileKey: null };

  const clearSignature = input.signatureFile === null;
  const after = {
    signatoryName: name ?? existing?.signatoryName ?? null,
    signatureFileKey: clearSignature ? null : (newKey ?? existing?.signatureFileKey ?? null),
  };
  if (!after.signatoryName) {
    if (uploadedKey) await deleteObject(uploadedKey).catch(() => {});
    return { ok: false, error: t("signatoryNameRequired") };
  }

  const oldKeyToDelete = existing?.signatureFileKey && existing.signatureFileKey !== after.signatureFileKey ? existing.signatureFileKey : null;

  try {
    await prisma.$transaction(async (db) => {
      await db.companySignatory.upsert({
        where: { singleton: true },
        create: { singleton: true, signatoryName: after.signatoryName!, signatureFileKey: after.signatureFileKey, updatedById: session.user.id },
        update: { signatoryName: after.signatoryName!, signatureFileKey: after.signatureFileKey, updatedById: session.user.id },
      });
      // Non-null `before` always — including on first creation, where it
      // explicitly records "no row yet" rather than omitting the field. The
      // neighbouring after-only pattern (server/payouts/export-stamp-plan.ts)
      // is NOT the example to follow here.
      await auditTx(db, {
        action: "company_signatory.updated",
        entityType: "CompanySignatory",
        entityId: existing?.id ?? null,
        before,
        after,
        actorUserId: session.user.id,
      });
    });
  } catch (e) {
    if (uploadedKey) await deleteObject(uploadedKey).catch(() => {});
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  if (oldKeyToDelete) await deleteObject(oldKeyToDelete).catch(() => {});

  revalidatePath("/admin/company");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Company details (registration numbers, contact details) printed on generated
// documents. Same gate as the signatory above: Admin only.
// ---------------------------------------------------------------------------

const DETAIL_FIELDS = ["legalName", "address", "uen", "paynowUen", "gstRegNo", "contactEmail", "phone", "website"] as const;

export async function listCompanyDetails() {
  const t = await getTranslations("errors");
  const session = await requireFullAdmin();
  if (!session) return { ok: false as const, error: t("forbidden") };
  const rows = await prisma.company.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, active: true, legalName: true, address: true, gstRegistered: true, uen: true, paynowUen: true, gstRegNo: true, contactEmail: true, phone: true, website: true },
  });
  return { ok: true as const, data: rows };
}

/** Replace one company's details (every field in the form is submitted; empty
 *  clears it). Touches only that company row, only these columns. */
export async function updateCompanyDetails(companyId: string, input: CompanyDetailsInput): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("errors");
  const session = await requireFullAdmin();
  if (!session) return { ok: false, error: t("forbidden") };

  const cleaned = cleanCompanyDetails(input);
  if (!cleaned.ok) return { ok: false, error: t(`companyDetails${cleaned.error[0].toUpperCase()}${cleaned.error.slice(1)}` as "companyDetailsUenInvalid") };
  const after = cleaned.data;

  const existing = await prisma.company.findUnique({ where: { id: companyId } });
  if (!existing) return { ok: false, error: t("notFound") };
  const before = Object.fromEntries(DETAIL_FIELDS.map((k) => [k, existing[k]]));

  try {
    await prisma.$transaction(async (db) => {
      await db.company.update({ where: { id: companyId }, data: after });
      await auditTx(db, {
        action: "company_details.updated",
        entityType: "Company",
        entityId: companyId,
        before,
        after,
        actorUserId: session.user.id,
      });
    });
  } catch (e) {
    if (e instanceof AuditWriteError) return { ok: false, error: t("auditUnavailable") };
    throw e;
  }
  revalidatePath("/admin/company");
  return { ok: true };
}
