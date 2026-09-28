/**
 * One-off backfill: re-render existing signed Associate Agreement PDFs into the
 * official V.2026-04 format. New agreements already use it; this rewrites the
 * ones signed before the format change.
 *
 * 🔴 RULING (28 Sep 2026, Samuel, via the MD): the signed PDF is the record of
 * what the associate signed and is NEVER modified after signing. This script's
 * entire purpose — overwriting an existing signedAgreementFileKey — is now
 * AGAINST that policy as a routine action. It is kept, not deleted, because a
 * legitimate authorised one-off use may still arise and it holds the backup
 * logic; it must NEVER be run against real records without Samuel's explicit
 * go on the day. Nothing runs it tonight regardless — this is the code-level
 * guard for whenever "later" arrives, not a green light now.
 *
 * Idempotent — safe to re-run; each write re-renders from source data and
 * overwrites the stored PDF. The previous PDF is copied to
 * `<key>.pre-v2607.bak` once (not overwritten on re-runs).
 *
 * Reconstructs AgreementData from the candidate + candidate.submittedPayload +
 * the stored signature, exactly as the onboarding flow did. Rewrites both the
 * candidate copy and, for converted candidates, the associate copy.
 *
 * 🔴 DEFAULT IS DRY-RUN (inverted from the original DRY=1-to-preview shape,
 * same reasoning as every other destructive job on this team: the destructive
 * path ships OFF, an explicit flag turns it on). Writing requires BOTH:
 *   WRITE=1                 — the explicit opt-in
 *   REASON="..."            — why this run is authorised; logged with every write
 * Run where the DB + storage volume + PII key are reachable (the app env), e.g.
 * a builder/deps container joined to the compose network with vo_uploads mounted
 * and STORAGE_DIR=/data/uploads:
 *   pnpm tsx scripts/backfill-associate-agreements.ts                 # dry run (default)
 *   WRITE=1 REASON="Samuel go 2026-10-xx" pnpm tsx scripts/backfill-associate-agreements.ts
 */
import { PrismaClient } from "@prisma/client";
import { getObject, putObject } from "@/lib/storage";
import { decryptPiiRaw, maskNric } from "@/lib/crypto";
import { humanize } from "@/lib/labels";
import { renderAgreementPdf, formatUplineOrNA, type AgreementData } from "@/lib/pdf/agreement";

const prisma = new PrismaClient();
const WRITE = process.env.WRITE === "1";
const REASON = process.env.REASON?.trim();
if (WRITE && !REASON) {
  console.error("Refusing to write: WRITE=1 requires REASON=\"...\" stating why this run is authorised (Samuel's go, dated).");
  process.exit(1);
}

type Payload = {
  businessName?: string | null; nric?: string | null; dateOfBirth?: string | null;
  residentialAddress?: string | null; emergencyContactName?: string | null; emergencyContactNumber?: string | null;
  maritalStatus?: string | null; spouseConflict?: boolean | null; spouseName?: string | null;
  spouseCompany?: string | null; spouseDesignation?: string | null; agreementAcceptedAt?: string | null;
};

async function backupOnce(key: string) {
  const bak = `${key}.pre-v2607.bak`;
  if (await getObject(bak)) return; // already backed up
  const cur = await getObject(key);
  if (cur) await putObject(bak, cur);
}

async function main() {
  const candidates = await prisma.candidate.findMany({
    where: { signedAgreementFileKey: { not: null } },
    include: {
      intendedDirectUpline: {
        select: { fullName: true, associateCode: true, directUpline: { select: { fullName: true, associateCode: true } } },
      },
      convertedAssociate: { select: { id: true, associateCode: true, signedAgreementFileKey: true } },
    },
  });
  console.log(
    `${candidates.length} signed agreement(s) to backfill — ${
      WRITE ? `WRITING (reason: ${REASON})` : "DRY RUN, no writes (set WRITE=1 and REASON=\"...\" to apply)"
    }`,
  );

  for (const c of candidates) {
    const p = (c.submittedPayload as Payload | null) ?? {};
    let sigDataUrl: string | null = null;
    const sig = await getObject(`candidates/${c.id}/signature.png`);
    if (sig) sigDataUrl = `data:image/png;base64,${sig.toString("base64")}`;

    let nricMasked: string | null = null;
    if (p.nric) { try { nricMasked = maskNric(decryptPiiRaw(p.nric)); } catch { nricMasked = null; } }

    const uplineName = c.intendedDirectUpline
      ? `${c.intendedDirectUpline.fullName} (${c.intendedDirectUpline.associateCode})` : null;

    const data: AgreementData = {
      fullName: c.fullName, designation: humanize(c.intendedDesignation ?? "Sales Associate"),
      email: c.email, mobile: c.mobileNumber, nricMasked,
      teamName: c.intendedTeam, uplineName,
      signedDate: p.agreementAcceptedAt ? new Date(p.agreementAcceptedAt) : c.updatedAt,
      signatureDataUrl: sigDataUrl,
      businessName: p.businessName ?? null, dateOfBirth: p.dateOfBirth ?? null,
      maritalStatus: p.maritalStatus ?? null, homeAddress: p.residentialAddress ?? null,
      commencementDate: c.commencementDate ? c.commencementDate.toISOString().slice(0, 10) : null,
      spouseConflict: p.spouseConflict ?? null, spouseName: p.spouseName ?? null,
      spouseCompany: p.spouseCompany ?? null, spouseDesignation: p.spouseDesignation ?? null,
      emergencyName: p.emergencyContactName ?? null, emergencyContact: p.emergencyContactNumber ?? null,
      // Associate ID intentionally NOT set — renderAgreementPdf never stamps
      // it regardless (Samuel's ruling), so passing it here would be dead
      // data implying otherwise.
      tier1Manager: formatUplineOrNA(c.intendedDirectUpline),
      tier2Manager: formatUplineOrNA(c.intendedDirectUpline?.directUpline),
    };

    const pdf = await renderAgreementPdf(data);
    const keys = [c.signedAgreementFileKey!, c.convertedAssociate?.signedAgreementFileKey].filter(Boolean) as string[];
    for (const key of keys) {
      if (!WRITE) { console.log(`  DRY RUN: would rewrite ${key} (${pdf.length} bytes)`); continue; }
      console.log(`  WRITING ${key} (reason: ${REASON})`);
      await backupOnce(key);
      await putObject(key, pdf);
      console.log(`  rewrote ${key} (${pdf.length} bytes)`);
    }
  }
  console.log("backfill complete");
}
main().finally(() => prisma.$disconnect());
