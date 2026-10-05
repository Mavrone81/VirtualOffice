/**
 * One-off backfill: re-render existing signed Associate Agreement PDFs into the
 * official V.2026-04 format. New agreements already use it; this rewrites the
 * ones signed before the format change.
 *
 * 🔴 RULING (28 Sep 2026, the owner, via the MD): the signed PDF is the record of
 * what the associate signed and is NEVER modified after signing. This script's
 * entire purpose — overwriting an existing signedAgreementFileKey — is now
 * AGAINST that policy as a routine action. It is kept, not deleted, because a
 * legitimate authorised one-off use may still arise and it holds the backup
 * logic; it must NEVER be run against real records without the owner's explicit
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
 *   WRITE=1 REASON="owner go 2026-10-xx" pnpm tsx scripts/backfill-associate-agreements.ts
 *
 * 🔴 TEMPLATE PROVENANCE GUARD (see lib/pdf/agreement-template-guard.ts for the
 * full reasoning). WRITE + REASON are a PROCEDURAL control: they stop an
 * accidental run, and stop nothing about a deliberate one aimed at the wrong
 * template. This script stamps stored values onto whatever master is on disk
 * NOW, and the Oct 2026 master is visually identical on both stamped pages
 * while a clause was removed from the middle — so re-rendering a pre-swap
 * signing produces a document that looks perfectly correct and attaches a real
 * signature to terms that were never agreed to.
 *
 * Every row is therefore checked against the sha of the master it was actually
 * signed against, in a PRE-FLIGHT pass that completes before the first render
 * and the first write. Any row that cannot be proven to have been signed
 * against the current master — including, especially, any row with no recorded
 * sha at all — refuses, and an un-overridden refusal aborts the whole run with
 * nothing written. See the pre-flight block in main() for why abort rather than
 * skip-and-continue.
 *
 * There is no bypass flag. Overriding is per-record and requires naming the
 * individual candidate ids plus an authorisation reason; there is no syntax for
 * "all rows", and the unset default is no override:
 *   OVERRIDE_TEMPLATE_GUARD_IDS="<candidate-id>,<candidate-id>"
 *   OVERRIDE_TEMPLATE_GUARD_REASON="who authorised re-rendering these, and when"
 * The guard is evaluated identically in dry-run, so a dry run previews exactly
 * which rows a write run would refuse.
 */
import { PrismaClient } from "@prisma/client";
import { getObject, putObject } from "@/lib/storage";
import { decryptPiiRaw, maskNric } from "@/lib/crypto";
import { humanize } from "@/lib/labels";
import { renderAgreementPdf, formatUplineOrNA, type AgreementData } from "@/lib/pdf/agreement";
import { MASTER_TEMPLATE_SHA256 } from "@/lib/pdf/associate-agreement-coordinates";
import {
  checkAgreementTemplateProvenance,
  parseTemplateGuardOverride,
  type TemplateRefusalCode,
} from "@/lib/pdf/agreement-template-guard";

const prisma = new PrismaClient();
const WRITE = process.env.WRITE === "1";
const REASON = process.env.REASON?.trim();
if (WRITE && !REASON) {
  console.error("Refusing to write: WRITE=1 requires REASON=\"...\" stating why this run is authorised (the owner's go, dated).");
  process.exit(1);
}

type Payload = {
  businessName?: string | null; nric?: string | null; dateOfBirth?: string | null;
  residentialAddress?: string | null; emergencyContactName?: string | null; emergencyContactNumber?: string | null;
  maritalStatus?: string | null; spouseConflict?: boolean | null; spouseName?: string | null;
  spouseCompany?: string | null; spouseDesignation?: string | null; agreementAcceptedAt?: string | null;
  // Written by submitOnboarding at signing (server/recruitment/actions.ts) —
  // which master this row's signed PDF was stamped onto. Absent on every row
  // signed before that record existed. Read by the pre-flight guard via
  // checkAgreementTemplateProvenance, which takes the raw payload rather than
  // this type: a guard must not trust a cast to tell it what shape the JSON is.
  agreementTemplateVersion?: string | null; agreementTemplateSha256?: string | null;
};

/** Thrown when the pre-flight refuses. Carries no PII — candidate ids and shas only. */
export class AgreementTemplateGuardError extends Error {
  constructor(readonly refusals: { id: string; code: TemplateRefusalCode }[], message: string) {
    super(message);
    this.name = "AgreementTemplateGuardError";
  }
}

async function backupOnce(key: string) {
  const bak = `${key}.pre-v2607.bak`;
  if (await getObject(bak)) return; // already backed up
  const cur = await getObject(key);
  if (cur) await putObject(bak, cur);
}

export async function main() {
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

  // -------------------------------------------------------------------------
  // PRE-FLIGHT: template provenance for every row, before the first render.
  //
  // 🔴 ABORT, NOT SKIP-AND-CONTINUE — and the pass is separate from the write
  // loop specifically so that aborting means "refused to start" rather than
  // "stopped halfway". Checking inline in the loop below and throwing on the
  // first bad row would leave the earlier rows already overwritten, which is
  // the worst available outcome: a corpus where some signed agreements have
  // been re-rendered and some have not, with nothing on the rows to say which.
  // Deciding everything first makes the run atomic in the only sense that
  // matters here — either no row was touched, or every row was cleared first.
  //
  // Why abort rather than rewrite the clean rows and skip the rest:
  //   - a refusal here is not a per-row data oddity, it is evidence that the
  //     operator's model of the run is wrong. The sha was introduced by the
  //     same commit that swapped the master, so "a few rows refused" is not a
  //     thing that happens: either the run is aimed at post-swap signings, or
  //     it is aimed at the catastrophe this guard exists to prevent.
  //   - skip-and-continue ends in "backfill complete" over a wall of
  //     refusals, and a job that completes successfully while refusing most of
  //     its input trains whoever runs it next to scroll past the refusals.
  //     Aborting forces a decision instead of producing a reassuring summary.
  //   - the partial result would need reconciling against a list of which rows
  //     were skipped, which exists only in the terminal scrollback.
  // Every refusal is still reported individually before the abort, so one run
  // tells the operator about all of the offending rows rather than the first.
  // -------------------------------------------------------------------------
  const override = parseTemplateGuardOverride();
  const cleared = new Set<string>();
  const blocking: { id: string; code: TemplateRefusalCode }[] = [];
  const overridden: string[] = [];

  for (const c of candidates) {
    // Deliberately the raw JSON value, not the `Payload` cast: a cast is an
    // assertion about shape, and this is the code whose job is to not trust it.
    const verdict = checkAgreementTemplateProvenance(c.submittedPayload);
    if (verdict.ok) {
      cleared.add(c.id);
      continue;
    }
    if (override?.ids.has(c.id)) {
      cleared.add(c.id);
      overridden.push(c.id);
      console.warn(
        `  🔴 OVERRIDDEN ${c.id} [${verdict.code}] stored=${verdict.storedSha ?? "(none)"} — ${verdict.reason}\n` +
          `     re-rendering anyway on explicit override. Authorisation: ${override.reason}`,
      );
      continue;
    }
    blocking.push({ id: c.id, code: verdict.code });
    console.error(
      `  REFUSED ${c.id} [${verdict.code}] stored=${verdict.storedSha ?? "(none)"} current=${MASTER_TEMPLATE_SHA256}\n` +
        `     ${verdict.reason}`,
    );
  }

  // An override id matching no refused row has permitted nothing, so it cannot
  // cause the harm this guard prevents — reported, not fatal, so that re-runs
  // after a row is resolved stay possible.
  const inert = [...(override?.ids ?? [])].filter((id) => !overridden.includes(id));
  if (inert.length) {
    console.warn(`  note: ${inert.length} override id(s) matched no refused row and did nothing: ${inert.join(", ")}`);
  }

  if (blocking.length) {
    const byCode = blocking.reduce<Record<string, number>>((a, r) => ({ ...a, [r.code]: (a[r.code] ?? 0) + 1 }), {});
    throw new AgreementTemplateGuardError(
      blocking,
      `ABORTED with nothing written: ${blocking.length} of ${candidates.length} signed agreement(s) were not ` +
        `signed against the current master (${MASTER_TEMPLATE_SHA256}) — ` +
        `${Object.entries(byCode).map(([k, v]) => `${v} ${k}`).join(", ")}. ` +
        "Re-rendering these would attach real signatures to clause text the signatories never agreed to, and " +
        "the output would look correct. Each row listed above must be re-rendered against the master it was " +
        "actually signed against, or named explicitly in OVERRIDE_TEMPLATE_GUARD_IDS with " +
        "OVERRIDE_TEMPLATE_GUARD_REASON stating who authorised it.",
    );
  }
  console.log(
    `  template provenance: ${cleared.size - overridden.length} row(s) match the current master` +
      `${overridden.length ? `, ${overridden.length} overridden` : ""}, 0 refused — proceeding.`,
  );

  for (const c of candidates) {
    // Invariant, not a second opinion: the pre-flight above either cleared
    // every row or threw. If a later refactor ever reaches this loop with an
    // uncleared row, it stops here rather than writing.
    if (!cleared.has(c.id)) {
      throw new AgreementTemplateGuardError([], `internal: reached the write loop with uncleared row ${c.id}`);
    }
    const p = (c.submittedPayload as Payload | null) ?? {};
    let sigDataUrl: string | null = null;
    const sig = await getObject(`candidates/${c.id}/signature.png`);
    if (sig) sigDataUrl = `data:image/png;base64,${sig.toString("base64")}`;

    // CR-0001: the company signatory SNAPSHOT already on this row — never a
    // live CompanySignatory read. This script re-renders an agreement signed
    // in the past; the signatory on file today may not be who/what was
    // stamped at the real signing moment, and the whole point of the
    // snapshot columns is that a later signatory change never rewrites
    // history. Absent for every row signed before this feature existed —
    // correctly renders as no stamp, not an invented one.
    let companySignatureDataUrl: string | null = null;
    if (c.companySignatureFileKeyAtSigning) {
      const companySig = await getObject(c.companySignatureFileKeyAtSigning);
      if (companySig) companySignatureDataUrl = `data:image/png;base64,${companySig.toString("base64")}`;
    }

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
      // it regardless (owner ruling), so passing it here would be dead
      // data implying otherwise.
      tier1Manager: formatUplineOrNA(c.intendedDirectUpline),
      tier2Manager: formatUplineOrNA(c.intendedDirectUpline?.directUpline),
      companySignatoryName: c.companySignatoryNameAtSigning,
      companySignatureDataUrl,
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
// Guarded so a test can import this module and call main() directly (e.g.
// with WRITE/REASON set per-test via vi.resetModules() + dynamic import)
// without the script also auto-running and disconnecting prisma underneath
// it. Only runs unguarded when executed directly: `pnpm tsx scripts/...`.
if (import.meta.url === `file://${process.argv[1]}`) {
  // The pre-flight refuses by THROWING rather than calling process.exit, so
  // that a test can import main() and assert the refusal without the exit
  // taking the test runner's worker down with it. Translating that throw into
  // a non-zero exit code is this wrapper's job, and it must stay non-zero: a
  // run that refused has not done its work, and anything scripting it (a
  // runbook step, CI) has to be able to tell.
  main()
    .catch((err: unknown) => {
      console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
