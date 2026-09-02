/**
 * One-off backfill: re-render existing signed Associate Agreement PDFs into the
 * official V.2026-04 format (lib/pdf/agreement.tsx). New agreements already use
 * it; this rewrites the ones signed before the format change.
 *
 * Idempotent — safe to re-run; each run re-renders from source data and
 * overwrites the stored PDF. The previous PDF is copied to
 * `<key>.pre-v2607.bak` once (not overwritten on re-runs).
 *
 * Reconstructs AgreementData from the candidate + candidate.submittedPayload +
 * the stored signature, exactly as the onboarding flow did. Rewrites both the
 * candidate copy and, for converted candidates, the associate copy.
 *
 * Run where the DB + storage volume + PII key are reachable (the app env). e.g.
 * a builder/deps container joined to the compose network with vo_uploads mounted
 * and STORAGE_DIR=/data/uploads:  pnpm tsx scripts/backfill-associate-agreements.ts
 * Add DRY=1 to report without writing.
 */
import { PrismaClient } from "@prisma/client";
import { getObject, putObject } from "@/lib/storage";
import { decryptPiiRaw, maskNric } from "@/lib/crypto";
import { humanize } from "@/lib/labels";
import { renderAgreementPdf, type AgreementData } from "@/lib/pdf/agreement";

const prisma = new PrismaClient();
const DRY = process.env.DRY === "1";

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
      intendedDirectUpline: { select: { fullName: true, associateCode: true } },
      convertedAssociate: { select: { id: true, associateCode: true, signedAgreementFileKey: true } },
    },
  });
  console.log(`${candidates.length} signed agreement(s) to backfill${DRY ? " (DRY RUN)" : ""}`);

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
      associateId: c.convertedAssociate?.associateCode ?? null, tier1Manager: uplineName,
    };

    const pdf = await renderAgreementPdf(data);
    const keys = [c.signedAgreementFileKey!, c.convertedAssociate?.signedAgreementFileKey].filter(Boolean) as string[];
    for (const key of keys) {
      if (DRY) { console.log(`  would rewrite ${key} (${pdf.length} bytes)`); continue; }
      await backupOnce(key);
      await putObject(key, pdf);
      console.log(`  rewrote ${key} (${pdf.length} bytes)`);
    }
  }
  console.log("backfill complete");
}
main().finally(() => prisma.$disconnect());
