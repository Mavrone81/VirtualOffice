import { MASTER_TEMPLATE_SHA256 } from "./associate-agreement-coordinates";

// ---------------------------------------------------------------------------
// Template provenance guard for re-rendering ALREADY-SIGNED agreements.
//
// 🔴 The failure this exists to prevent produces NO visible defect.
//
// scripts/backfill-associate-agreements.ts re-renders past signings by stamping
// stored field values onto whatever master PDF is currently on disk. The Oct
// 2026 swap replaced that master with one whose pages 1 and 7 — the only
// stamped pages — are word- and pixel-identical to the previous master, while a
// clause was REMOVED from the middle and the numbering shifted.
//
// So re-rendering a pre-swap signing against the current master yields a
// document that is correct in every respect a reader can check: the right name,
// the right dates, the real signature, in the right boxes, on a template whose
// footer marker is unchanged. The only thing wrong with it is the thing no
// inspection can see — the signature is now attached to a clause set the person
// never agreed to. There is no corrupted glyph to notice and no exception to
// catch; the output looks perfectly correct.
//
// A guard against a defect that announces itself can afford to be advisory.
// This one cannot, so it is built to FAIL CLOSED: the single `ok: true` return
// at the bottom of checkAgreementTemplateProvenance is reachable only by an
// exact 64-hex-char match against the pinned master. Every other input shape —
// absent, null, empty, non-string, wrong length, wrong value, payload not an
// object at all — refuses on the way there.
//
// ABSENT IS NOT "UNKNOWN, PROCEED". It is the single most important rule here.
// agreementTemplateSha256 was introduced by the SAME commit that swapped the
// master (see server/recruitment/actions.ts, in the submitOnboarding payload),
// so every row signed before that swap carries no sha at all. Absent therefore
// means precisely "signed against the previous master" — it is the historical
// marker of exactly the rows that must never be re-rendered, not a gap to be
// given the benefit of the doubt. Treating absent as permission to proceed
// would let the guard wave through every genuinely dangerous row in the table
// while blocking none of them.
// ---------------------------------------------------------------------------

/** Lowercase hex, exactly 32 bytes — the shape `createHash("sha256").digest("hex")` produces. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type TemplateRefusalCode =
  /** No sha recorded: signed before the sha was recorded at all, i.e. against an older master. */
  | "absent"
  /** A sha is present but is not a sha256 hex digest — provenance is unreadable, so it is not provenance. */
  | "malformed"
  /** A readable sha that is not the current master's: signed against a different, identifiable template. */
  | "mismatch";

export type TemplateProvenanceVerdict =
  | { ok: true; storedSha: string }
  | { ok: false; code: TemplateRefusalCode; storedSha: string | null; reason: string };

/**
 * Decide whether one signed agreement may be re-rendered against the master
 * currently pinned by MASTER_TEMPLATE_SHA256.
 *
 * Reads `agreementTemplateSha256` out of the candidate's `submittedPayload`
 * JSON — the record submitOnboarding already writes at signing time. Nothing
 * new is recorded and no schema change is involved; this reads what is there.
 *
 * Deliberately takes no "expected sha" parameter. An injectable expectation is
 * convenient for tests and is also, in a guard, a bypass: a caller could hand
 * it the row's own stored sha and every row would pass. Tests cover the
 * matching case by importing the same pinned constant the script uses.
 */
export function checkAgreementTemplateProvenance(submittedPayload: unknown): TemplateProvenanceVerdict {
  const isPlainObject =
    typeof submittedPayload === "object" && submittedPayload !== null && !Array.isArray(submittedPayload);
  const raw = isPlainObject ? (submittedPayload as Record<string, unknown>).agreementTemplateSha256 : undefined;

  if (raw === undefined || raw === null || raw === "") {
    return {
      ok: false,
      code: "absent",
      storedSha: null,
      reason:
        "no agreementTemplateSha256 recorded — this row was signed before the template sha was recorded, " +
        "i.e. against an OLDER master. Absent provenance is a refusal, never an assumption that it matches.",
    };
  }

  if (typeof raw !== "string" || !SHA256_HEX.test(raw)) {
    return {
      ok: false,
      code: "malformed",
      storedSha: typeof raw === "string" ? raw : null,
      reason:
        "agreementTemplateSha256 is present but is not a sha256 hex digest, so it does not identify any " +
        "template. Unreadable provenance is refused on the same footing as absent provenance.",
    };
  }

  if (raw !== MASTER_TEMPLATE_SHA256) {
    return {
      ok: false,
      code: "mismatch",
      storedSha: raw,
      reason:
        `signed against master ${raw}, but the current master is ${MASTER_TEMPLATE_SHA256}. Re-rendering ` +
        "would stamp this signature onto a different clause set than the one that was agreed to.",
    };
  }

  // The ONLY path to a pass: an exact match against the pinned master.
  return { ok: true, storedSha: raw };
}

// ---------------------------------------------------------------------------
// Override.
//
// Requirements: explicit, reasoned, and impossible to trigger by default.
//
// The shape matters as much as the existence. A boolean (FORCE=1) would satisfy
// "explicit" on paper while re-arming the entire original hazard with four
// keystrokes, and would be exactly the thing that ends up pasted into a
// runbook. So the override is not a mode — it is a PER-RECORD ALLOWLIST. The
// operator names the individual candidate ids being re-rendered despite a
// refusal, and there is no syntax for "all": wildcard-looking tokens are
// rejected outright rather than being treated as an id that matches nothing,
// so an operator who reaches for `*` gets an error instead of a run that looks
// authorised and silently covers no rows.
//
// Consequences of this shape, all intended:
//   - unset env  ->  no override exists. This is the default and needs no flag.
//   - the cost of overriding scales with the number of rows, so it cannot be
//     used to wave through a table; it can only be used to name a few rows
//     somebody has actually looked at.
//   - a reason is structurally required, not merely requested, and is logged
//     against each row it covers.
// ---------------------------------------------------------------------------

/** Tokens an operator might reach for to mean "everything". None of them are valid ids, and all are rejected. */
const WILDCARD_TOKENS = new Set(["*", "all", "any", "-", "any_id", "*.*"]);

const MIN_OVERRIDE_REASON_LENGTH = 20;

export type TemplateGuardOverride = { ids: Set<string>; reason: string };

/** Only the two variables the override is made of — not the whole ProcessEnv, so a
 *  caller cannot widen this into "reads any env it likes" and a test need not
 *  synthesise an entire environment to exercise one case. */
export type TemplateGuardOverrideEnv = {
  OVERRIDE_TEMPLATE_GUARD_IDS?: string;
  OVERRIDE_TEMPLATE_GUARD_REASON?: string;
  [other: string]: string | undefined;
};

export class TemplateGuardConfigError extends Error {}

/**
 * Parse the override from the environment. Returns null when no override is
 * configured — the default, and the only state reachable without someone
 * deliberately setting both variables.
 *
 * Throws (rather than degrading to "no override") on every self-contradictory
 * configuration, including a reason given with no ids. A stale reason left in
 * the environment with no ids means the operator believes an override is in
 * force when it is not; failing loudly there is the whole point, since the
 * alternative is a run that quietly refuses everything for reasons the
 * operator has already explained to themselves.
 */
export function parseTemplateGuardOverride(env: TemplateGuardOverrideEnv = process.env): TemplateGuardOverride | null {
  const rawIds = env.OVERRIDE_TEMPLATE_GUARD_IDS?.trim() ?? "";
  const reason = env.OVERRIDE_TEMPLATE_GUARD_REASON?.trim() ?? "";

  if (!rawIds) {
    if (reason) {
      throw new TemplateGuardConfigError(
        "OVERRIDE_TEMPLATE_GUARD_REASON is set but OVERRIDE_TEMPLATE_GUARD_IDS is empty. An override must " +
          "name the specific candidate ids it covers; a reason on its own overrides nothing and would have " +
          "left this run refusing every mismatched row while looking authorised.",
      );
    }
    return null;
  }

  const ids = rawIds
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const wildcards = ids.filter((id) => WILDCARD_TOKENS.has(id.toLowerCase()));
  if (wildcards.length) {
    throw new TemplateGuardConfigError(
      `OVERRIDE_TEMPLATE_GUARD_IDS contains ${wildcards.join(", ")}, which is not a candidate id. There is no ` +
        "syntax for overriding every row: each record re-rendered against a template it was not signed " +
        "against must be named individually.",
    );
  }

  if (reason.length < MIN_OVERRIDE_REASON_LENGTH) {
    throw new TemplateGuardConfigError(
      `OVERRIDE_TEMPLATE_GUARD_IDS names ${ids.length} record(s) but OVERRIDE_TEMPLATE_GUARD_REASON is ` +
        `${reason.length} character(s); at least ${MIN_OVERRIDE_REASON_LENGTH} are required. State who ` +
        "authorised re-rendering these signatures onto a different clause set, and when.",
    );
  }

  return { ids: new Set(ids), reason };
}
