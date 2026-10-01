import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Associate Agreement — stamp-onto-master coordinates.
//
// The owner's requirement: the signed agreement must be visually IDENTICAL to
// the master (header spacing, fonts, font types, paragraphing) — so instead
// of re-typesetting the document, we load the master PDF as-is and stamp
// only the filled-in values onto it at fixed positions, page by page.
//
// Every box below was measured directly off `public/templates/associate-
// agreement.pdf` with `pdftotext -bbox` (word positions) and pixel-level
// table-border detection on a 150dpi raster of the same file — never
// guessed, never taken from the old re-typeset renderer's layout.
//
// Coordinate convention (shared with Frontend, who owns pages 4-7's boxes):
//   - points, TOP-LEFT origin per page (x right, y down from the page's top)
//     — this is pdftotext -bbox's own convention, so a measurement can be
//     copied straight from its output with no mental conversion.
//   - `page` is 1-indexed, matching the printed "Page N of 7" footer.
//   - a box is the SPACE AVAILABLE for the value (from just past the
//     printed label to the next column divider / row border), not a single
//     anchor point — the stamping code decides font size (shrink-to-fit)
//     and wrapping inside it, per the owner's "never overflowing" rule.
// The stamping code (agreement.ts) does the one conversion to pdf-lib's
// bottom-left page origin; nothing that measures a box needs to think
// about that flip.
// ---------------------------------------------------------------------------

export const MASTER_TEMPLATE_PATH = "public/templates/associate-agreement.pdf";

/** Measured 2026-09-28 against the file at MASTER_TEMPLATE_PATH. Every box
 *  below is only valid for a template with this exact byte content — a
 *  different template means different label positions, so this is asserted
 *  at load time (assertMasterTemplateSha256 in agreement.ts) rather than
 *  trusted. If the template is legitimately replaced, this hash — and every
 *  box in this file — must be re-measured, not just updated blindly. */
export const MASTER_TEMPLATE_SHA256 = "1008cd7b1e0ac68e417fa613259290d7183475c2be1db09f989102a4dd7489b5";

export const PAGE_SIZE = { width: 595.28, height: 841.89 } as const; // A4, points

export type FieldBox = {
  /** 1-indexed, matches the printed "Page N of 7" footer. */
  page: number;
  /** Left edge, points, top-left page origin. */
  x: number;
  /** Top edge, points, top-left page origin. */
  y: number;
  /** Box width, points. */
  width: number;
  /** Box height, points — the vertical space available (line height / blank strip depth). */
  height: number;
};

export function assertMasterTemplateSha256(bytes: Uint8Array): void {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== MASTER_TEMPLATE_SHA256) {
    throw new Error(
      `associate-agreement.pdf has changed (sha256 ${actual}, expected ${MASTER_TEMPLATE_SHA256}) — ` +
        `every coordinate in associate-agreement-coordinates.ts was measured against the old file and ` +
        `must be re-measured against the new one before this renders anything.`,
    );
  }
}

/**
 * Field boxes, keyed to match `AgreementData` field names 1:1 where there is
 * one. Owned jointly: Backend measured pages 1-3, Frontend pages 4-7 — see
 * the message thread rather than guessing who owns which key from the page
 * number alone, since a couple of page-1 keys (the three "made on" blanks,
 * the signature-page trio) don't have a plain 1:1 AgreementData name.
 */
export const AGREEMENT_FIELD_BOXES: Record<string, FieldBox> = {
  // ---- Page 1: "THIS AGREEMENT is made on the __ day of __ 20__" ----
  // Measured from the label line's own word bbox (y=[131.9,141.8]); the
  // three blanks sit inline on that single line, between the fixed words.
  madeDay: { page: 1, x: 176, y: 130, width: 37, height: 12 },
  madeMonth: { page: 1, x: 240, y: 130, width: 100, height: 12 },
  madeYearYY: { page: 1, x: 354, y: 130, width: 29, height: 12 },

  // ---- Page 1: particulars table ----
  // Table outer border x=[42.75,552.25] (pixel-detected); row borders
  // y = 156.72 / 197.04 / 227.52 / 257.76 / 288.00 / 318.48 (pixel-detected,
  // 150dpi raster of page 1). Column dividers per row, same method.
  // Each box starts just below that row's printed label/hint text and ends
  // just above the row's bottom border — the blank line the paper form
  // expects the value written on.
  fullName: { page: 1, x: 47, y: 184, width: 501, height: 12 }, // row: "Name of Applicant..." (below label + hint)
  businessName: { page: 1, x: 47, y: 212, width: 501, height: 14 }, // row: "Business Name:"
  nricMasked: { page: 1, x: 47, y: 242, width: 246, height: 14 }, // row: "NRIC No:" (col 1 of 2, divider at 297.5)
  nationality: { page: 1, x: 302, y: 242, width: 246, height: 14 }, // same row, col 2
  dateOfBirth: { page: 1, x: 47, y: 273, width: 178, height: 13 }, // row: DOB/Gender/Marital, col 1 (divider at 229.5)
  gender: { page: 1, x: 234, y: 273, width: 159, height: 13 }, // col 2 (divider at 397.5)
  maritalStatus: { page: 1, x: 402, y: 273, width: 146, height: 13 }, // col 3
  homeAddress: { page: 1, x: 47, y: 303, width: 246, height: 14 }, // row: Home Address/Mobile/Religion, col 1 (divider at 297.5)
  mobile: { page: 1, x: 302, y: 303, width: 91, height: 14 }, // col 2 (divider at 397.5)
  religion: { page: 1, x: 402, y: 303, width: 146, height: 14 }, // col 3

  // ---- Page 7: signature block ----
  // "SIGNED By the )" / "Abovementioned Associate )" / "Name: )" /
  // "NRIC No.: )" — every line's blank runs from just past its own label to
  // the ")" bracket, which sits at a fixed x=[240.9,243.9] on all four lines.
  signatureName: { page: 7, x: 85, y: 399, width: 152, height: 10 },
  signatureNric: { page: 7, x: 85, y: 409, width: 152, height: 10 },
  // The owner moved the signature image: NOT between the labels and the ")"
  // column (superseded — was { x: 145, y: 379, width: 91, height: 20 }, the
  // strip left of the bracket, spanning the company block's two lines),
  // but to the RIGHT of the ")" column (x=[240.94,243.94]), beside the
  // ASSOCIATE block specifically (the second "SIGNED", not the company one
  // at y 328.86). Derived from the master's own glyph bboxes via
  // `pdftotext -bbox`, both spaces reconciled before locking:
  //   pdftotext space (top-left, y down): x 257.0->404.0, y 365.45->430.85
  //   pdf-lib space   (bottom-left, y up): x=257.0, y=411.04 (bottom edge),
  //     width=147.0, height=65.40
  //   — reconciliation: y(pdf-lib) = 841.89 - 430.85 = 411.04, and
  //     y+height = 476.44 = 841.89 - 365.45. Both directions agree.
  // This file's schema is top-left/page-relative throughout (see the header
  // comment), so the box below is in THAT space — the pdf-lib numbers above
  // are the audit trail proving the conversion, not what's stored.
  // Block span reconciled from line CENTRES, not bbox edges (18.4pt above
  // "SIGNED"'s centre 383.85, 17.0pt below "NRIC"'s centre 413.85 = 65.40pt
  // total), which is why 3 independently-stated numbers (18+39.97+17=74.97
  // vs the stated ~66pt) needed a centre-vs-edge reading to reconcile rather
  // than picking one and dropping the other two.
  signatureImage: { page: 7, x: 257.0, y: 365.45, width: 147.0, height: 65.4 },
  // "Signed ... via the onboarding portal" — owner ruling: move it to the
  // FOOTER area at the bottom of page 7, in the master's own small grey
  // footer style, clear of both "Page 7 of 7 / V.2026-04" (measured via
  // pdftotext -bbox: y=[818.4,827.7]) and the For Official Use table's own
  // bottom border (y=763.0, from the row-divider measurements below) — must
  // not overlap anything printed in the master. Placed at y=[798,810]: 8.4pt
  // clear of the footer line above it, 35pt clear of the table below it.
  // Footer grey sampled from a 300dpi raster of the actual "Page 7 of 7"
  // text: dominant pixel rgb(192,192,192) = rgb(0.75,0.75,0.75) — see
  // FOOTER_GREY in agreement.ts, kept there (not here) per this file's own
  // rule that it holds geometry only, not rendering choices.
  signedAtNote: { page: 7, x: 42.75, y: 798, width: 509.5, height: 12 },

  // ---- Page 7, Frontend-measured (reviews/agreement-pdf-pages-4-7-blanks.md) ----
  // STATUS (updated, not the original "overflow proof only" note — that
  // scope has since landed in full, see the block below): single-line
  // shrink-then-truncate only, no wrap (ec61e1f); every other page-7 field
  // (spouse block, commencement checkboxes, official-use) is wired below,
  // merged from frontend/agreement-pdf-boxes-4-7.
  // height 14->18->14: Frontend bumped this to 18 after finding the original
  // wrap-then-shrink shrank text to ~3.4pt (illegible). Backend rendered the
  // 18pt version and found a WORSE failure: the underline sits at a fixed
  // position on the master regardless of any height number handed to the
  // renderer, so a bottom-anchored 2nd line at 18pt crossed straight through
  // the underline (struck-through look) — growing the declared height
  // doesn't create real printable space, since the master's own rule doesn't
  // move. Real fix (Backend, ec61e1f): dropped multi-line wrap from fitText
  // entirely — single-line shrink (9pt floor) + ellipsis-truncate. Every box
  // on this page is a single printed row anchored to its own underline with
  // no real vertical slack, so single-line-only is the correct model here,
  // not a workaround. Reverted to the ORIGINAL height=14, which was right
  // for the single-line case all along.
  emergencyContactAddress: { page: 7, x: 111.4, y: 230.5, width: 213.8, height: 14 },

  // ---- Page 7, Frontend's remaining pass (pages 4-6 have NO blanks at all,
  // confirmed pixel-by-pixel, not assumed from reading the clause text —
  // every field below is on page 7, same as emergencyContactAddress above).
  // All anchored to actual drawn table borders / underline rules from a
  // 300dpi raster, not inferred from label gaps — see the review doc.

  // (a) Commencement Date — 2 checkboxes (NOT text; stampCheckbox) + 1 date blank.
  commencementImmediateCheckbox: { page: 7, x: 196.08, y: 114.12, width: 16.08, height: 15.12 },
  commencementOnCheckbox: { page: 7, x: 338.88, y: 114.12, width: 16.08, height: 15.12 },
  commencementOnDate: { page: 7, x: 401.8, y: 113.4, width: 125.0, height: 14 },

  // (b) Spouse conflict-of-interest.
  spouseName: { page: 7, x: 145.2, y: 160.7, width: 216.0, height: 14 },
  spouseCompanyName: { page: 7, x: 154.6, y: 173.9, width: 206.6, height: 14 },
  spouseDesignation: { page: 7, x: 126.7, y: 186.8, width: 234.5, height: 14 },
  // spouseWorking (Yes/No): not a text field — no blank or underline at all,
  // a human circles/strikes one word. The owner's ruling: draw a circle
  // (stampCircle) around whichever word applies when AgreementData.
  // spouseConflict is true/false; circle neither when it's null/undefined
  // (same "no data, no mark" rule as every other blank).
  // 🔴 This box is NOT what stampCircle draws from any more (see
  // AGREEMENT_CIRCLE_WORD_INK below) — kept here only as the coarse region
  // other code (the mark-pair coverage census) still keys off, and because
  // it's still a reasonable pdftotext-reported "tight bbox". It measurably
  // OVER-states the real printed ink on both axes (most on height: 11.07 vs
  // the word's actual ~6.6pt ink height) — exactly the box-vs-measured gap
  // AGREEMENT_FIELD_RULE_Y closed for rule positions; AGREEMENT_CIRCLE_WORD_INK
  // closes the same gap for these two circle targets.
  spouseWorkingYes: { page: 7, x: 470.68, y: 162.83, width: 14.55, height: 11.07 },
  spouseWorkingNo: { page: 7, x: 493.01, y: 162.83, width: 12.22, height: 11.07 },

  // (c) Emergency contact.
  emergencyContactName: { page: 7, x: 109.2, y: 217.6, width: 216.0, height: 14 },
  emergencyContactRelationship: { page: 7, x: 417.1, y: 217.6, width: 124.1, height: 14 },
  // emergencyContactAddress already above (wired in as the overflow proof).
  emergencyContactNumber: { page: 7, x: 433.0, y: 230.5, width: 108.2, height: 14 },

  // For Official Use — row dividers pixel-detected (y=708.6/726.8/744.8/763.0),
  // column divider at x=143.04; every value cell runs to the table's own
  // right border (x=552.5), not a guessed width.
  associateIdOfficial: { page: 7, x: 143.04, y: 708.6, width: 409.46, height: 18.2 },
  tier1ManagerOfficial: { page: 7, x: 143.04, y: 726.8, width: 409.46, height: 18.0 },
  tier2ManagerOfficial: { page: 7, x: 143.04, y: 744.8, width: 409.46, height: 18.2 },

  // CR-0001: the company signatory's signature + printed name, right of the
  // "SIGNED by the Abovementioned Company )" bracket. Measured the same way
  // as signatureImage above — pdftotext -bbox on the pristine master, top-
  // left space: "SIGNED by the" y=[328.86,338.83], "Abovementioned Company"
  // y=[338.86,348.83], bracket ")" at x=[240.94,243.94] on both lines, and
  // (unlike the associate block) NOTHING ELSE printed anywhere in
  // x=[244,548] y=[318.83,378.86] — confirmed by dumping every word in that
  // band — so the whole span down to the next block ("SIGNED By the", y=
  // 378.86) is free to use, mirroring how signatureImage uses its own
  // available whitespace rather than hugging the two label lines. Split into
  // an upper image region and a lower single-line name region (signature
  // above the printed name, the usual convention for a signature block) —
  // this split is ours, not measured off the master, since the master has no
  // printed "Name:" sub-line for the company the way it does for the
  // associate (signatureName/signatureNric above).
  companySignatureImage: { page: 7, x: 258, y: 320.8, width: 116, height: 36.1 },
  companySignatoryName: { page: 7, x: 258, y: 360, width: 116, height: 14.9 },
};

// 🔴 CORRECTION to a finding recorded here earlier the same evening (kept,
// not deleted, per the same "annotate don't silently edit" rule): the
// interior row dividers at 726.8/744.8 DO exist — the row-divider comment
// two blocks up was right all along. The original scan (absolute darkness
// threshold, r<150) genuinely found no ink there, but that was a threshold
// bug, not a fact about the page: these two dividers are a deliberate LIGHT
// GREY (grayscale luminance 165.9, not the outer borders' true black 0),
// visually distinct from the bold black table border, uniform across the
// full row width for 2 consecutive pixel-rows at 300dpi. Re-verified
// independently (grayscale render, raw luminance, no classification) at
// y=[726.72,726.96] and y=[744.72,744.96] — confirmed real: blank
// immediately above and below each band, not an anti-aliasing artefact
// (those aren't uniform across 2000+ pixels). Corrected rule_y below:
// associateIdOfficial=726.72, tier1ManagerOfficial=744.72.
// tier1ManagerOfficial and associateIdOfficial still ALIGN TO THEIR LABEL
// (see TIER1/TIER2_OFFICIAL_LABEL_BASELINE in agreement.ts), by deliberate
// choice now rather than because no rule existed to use instead: the MD's
// defect was the value sitting BELOW its own label, and matching the
// label's baseline is what fixes that specifically. Both anchors coexist
// safely — the label baseline (738.48) sits 6.24pt clear of the now-known
// rule (744.72), comfortable margin either way.

/**
 * Each field's own printed rule position, measured directly on the
 * PRISTINE, UNSTAMPED master (never inferred from rendered ink or from a
 * box's own height/`y`) — see reviews/agreement-pdf-rule-y-table.md for
 * method, the full per-field findings, and the falsifiable predictions each
 * `null` confirms or refutes. Space: top-left, page-relative, same as
 * AGREEMENT_FIELD_BOXES. Edge convention: the rule's TOP edge (the edge ink
 * reaches first) — stated explicitly so two different measuring tools
 * never disagree over which edge, only over the number.
 *
 * `stampField` requires ONE of `ruleFromTop` (from this table) or an
 * explicit `baselineFromTop` override on every call — never falls back to
 * `box.y + box.height`, because that quantity was exactly the false
 * premise behind the original defect (a box's bottom edge is NOT
 * necessarily its rule). A `null` here means "measured, and there genuinely
 * is no rule" for a field that IS stamped as text (signatureName,
 * signatureNric, signedAtNote — confirmed absent by finding literally ZERO
 * ink anywhere in a generous search window, not merely "below a threshold";
 * see reviews/agreement-pdf-rule-y-table.md) — those get their own explicit
 * `baselineFromTop` override instead, never left to guess. The 5 remaining
 * `null`s are fields that aren't text at all (2 checkboxes, 2 circle
 * targets, the signature image) — "rule_y" isn't a meaningful concept for
 * them, so they're not called through `stampField`. 8 nulls total, 24
 * measured.
 */
export const AGREEMENT_FIELD_RULE_Y: Record<keyof typeof AGREEMENT_FIELD_BOXES, number | null> = {
  madeDay: 140.16, // real rule, NOT assumed absent — see reviews/agreement-pdf-rule-y-table.md finding 1
  madeMonth: 140.16,
  madeYearYY: 140.16,
  fullName: 197.04,
  businessName: 227.28,
  nricMasked: 257.52,
  nationality: 257.52,
  dateOfBirth: 288.0,
  gender: 288.0,
  maritalStatus: 288.0,
  homeAddress: 318.24,
  mobile: 318.24,
  religion: 318.24,
  signatureName: null, // no rule found (confirms Frontend's own note); gets an explicit baselineFromTop instead
  signatureNric: null, // no rule found; gets an explicit baselineFromTop instead
  signatureImage: null, // not text — no rule_y concept applies
  signedAtNote: null, // no rule found (confirms DevLead's stated prediction); our own placement, gets an explicit baselineFromTop
  commencementImmediateCheckbox: null, // not text — checkbox
  commencementOnCheckbox: null, // not text — checkbox
  commencementOnDate: 125.28,
  spouseName: 172.56,
  spouseCompanyName: 185.76,
  spouseDesignation: 198.72,
  spouseWorkingYes: null, // not text — circle target
  spouseWorkingNo: null, // not text — circle target
  emergencyContactName: 229.44,
  emergencyContactRelationship: 229.44,
  emergencyContactAddress: 242.4, // the field the owner's truncation ruling is about — now has a real measured anchor
  emergencyContactNumber: 242.4,
  associateIdOfficial: 726.72, // light-grey interior divider (see correction above); never stamped anyway (owner ruling)
  tier1ManagerOfficial: 744.72, // light-grey interior divider (see correction above); renderer aligns to its label instead by choice, not by necessity
  tier2ManagerOfficial: 762.72, // the table's own real bottom border
  companySignatureImage: null, // not text — signature image, our own placement in confirmed-blank space
  companySignatoryName: null, // no rule found (the master has no "Name:" sub-line for the company block at all); gets an explicit baselineFromTop instead
};

/**
 * Ink extents of the "Yes"/"No" glyphs themselves, measured directly off a
 * rendered raster of the pristine master — NOT the pdftotext-reported
 * bounding box in `AGREEMENT_FIELD_BOXES` above, which is measurably larger
 * than the real ink on both axes (most on height: 11.07pt box vs ~6.6pt of
 * actual ink). `stampCircle` derives its ellipse from THIS table.
 * Space: top-left, page-relative, same convention as everything else in
 * this file. Measured at 600dpi (0.12pt/px grid) via Ghostscript, cross-
 * checked against a second, independent rasterizer at the same and finer
 * (1200dpi) resolution — all agreed within one 600dpi pixel. 300dpi was
 * tried and discarded: it disagreed with both by ~0.3pt, consistent with
 * quantisation (a known trap on this exact page — see the CIRCLE_PAD
 * history this table replaces), not a second real measurement.
 */
export const AGREEMENT_CIRCLE_WORD_INK: Record<"spouseWorkingYes" | "spouseWorkingNo", { minX: number; minY: number; maxX: number; maxY: number }> = {
  spouseWorkingYes: { minX: 470.72, minY: 165.15, maxX: 484.76, maxY: 171.75 },
  spouseWorkingNo: { minX: 492.81, minY: 165.15, maxX: 504.69, maxY: 171.75 },
};
