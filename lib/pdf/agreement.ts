import { readFileSync } from "fs";
import { join } from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  MASTER_TEMPLATE_PATH,
  PAGE_SIZE,
  AGREEMENT_FIELD_BOXES,
  AGREEMENT_FIELD_RULE_Y,
  assertMasterTemplateSha256,
  type FieldBox,
} from "@/lib/pdf/associate-agreement-coordinates";

// ---------------------------------------------------------------------------
// Associate Agreement — stamp values onto the master PDF, verbatim, rather
// than re-typesetting it. Samuel's requirement is that the signed document
// look IDENTICAL to the master (header spacing, fonts, font types,
// paragraphing) — the only way that's true by construction, not by
// imitation, is to leave every page of the original untouched except the
// filled-in values. See associate-agreement-coordinates.ts for where each
// value is placed and why.
// ---------------------------------------------------------------------------

const INK = rgb(0.1, 0.12, 0.17);
// Sampled from a 300dpi raster of the master's own "Page 7 of 7" footer text
// (dominant pixel rgb(192,192,192)) — matches the master's own small grey
// footer style for the relocated "Signed ... via the onboarding portal" line.
const FOOTER_GREY = rgb(0.75, 0.75, 0.75);
const FOOTER_FONT_SIZE = 8;
const FONT_START_SIZE = 9;
// Legibility floor, not just a fit floor: 6pt Times, measured against the
// real 93-char-address proof, rendered readable on an upscaled screen crop
// but at roughly a third of the surrounding printed labels' size — visibly
// not the same document, which is the one thing this whole approach exists
// to avoid. 7pt is the smallest size that still reads as "the same
// document's text" rather than "a shrunk footnote." A box too narrow to
// wrap even a floor-size value to fit its height gets ellipsis truncation
// (below), never a size below this floor and never overflow past the box.
const FONT_MIN_SIZE = 7;
const LINE_GAP = 1.15;

// ---------------------------------------------------------------------------
// Baseline clearance — ROOT CAUSE (DevLead): `drawText`'s `y` is the
// BASELINE, not the bottom of the ink. Times-Roman's descender extends
// BELOW the baseline by 1.953pt at 9pt (1.736 at 8pt, 1.519 at 7pt — AFM
// `Descender = -217/1000 em`, cross-checked against pdf-lib's own
// `heightAtSize`), so the old flat "2pt from the box's bottom edge" left a
// 'p'/'g'/'y' RIGHT ON the rule at 9pt (0.047pt to spare), and a flat
// replacement constant is ALSO wrong: the descender shrinks with `fitText`'s
// own size, so a fixed clearance either under- or over-clears depending on
// which size got picked. Clearance is derived from the SAME `size` fitText
// returns, so the two can never drift apart.
//
// 🔴 CORRECTION TO DEVLEAD'S ORIGINAL FORMULA, found re-measuring after
// applying it: DevLead's model assumes "the box's bottom edge IS the rule" —
// true for the page-1 particulars rows (measured: box bottom sits within
// ~1-2pt of the real row border) but NOT for this page-7 family. Frontend's
// own stated convention for these boxes — "y = the underline's own
// y-position MINUS 12pt, height = 14pt" (reviews/agreement-pdf-pages-4-7-
// blanks.md:53) — means the box is DELIBERATELY 2pt taller than the
// distance to the rule, for buffer room, so box.y+box.height sits ~2.12pt
// PAST the true rule position. Verified directly: measured the real rule's
// TOP edge (the edge ink reaches first) at box.y+11.84 to +11.92 across 8
// different boxes (spouseName, spouseCompanyName, spouseDesignation,
// commencementOnDate, emergencyContactName/Relationship/Address/Number),
// consistently ~box.y+12, matching the documented convention almost exactly
// — NOT box.y+14. Applying DevLead's formula against box.y+box.height (as
// first written) gave a real descender-to-rule gap of only ~0.24pt on every
// box with an actual descender in its value (measured on rendered output,
// not assumed) — the same defect one order of magnitude smaller, invisible
// unless you render a descender specifically and measure past the rule.
// Fix: anchor the descender math to the box's OWN measured rule position
// (`ruleFromTop`, an explicit per-call override — see UNDERLINE_RULE_OFFSET
// below), not to box.y+box.height. Reported to DevLead before landing, since
// their planned mechanical gate checks this exact arithmetic and would have
// passed on the wrong anchor.
// 🔴 SUPERSEDED, kept as the record of how this was found (the box.y+12
// reasoning above is what led to measuring every field directly): the model
// has since moved from "box.y + a per-family offset constant" to "each
// field's own measured rule_y, stored directly" in AGREEMENT_FIELD_RULE_Y —
// universal, all 32 fields, no box-bottom or derived offset involved at
// all. See reviews/agreement-pdf-rule-y-table.md for the method and every
// field's measured value (or measured absence).
const BASELINE_INK_CLEARANCE = 1.75; // the actual ink-to-rule gap wanted, independent of font size
// CANARY (found by a gate probe): `madeDay` has only ~0.31pt of headroom above
// its own box TOP at FONT_START_SIZE (its box is 12pt tall vs the usual
// 14pt) — the tightest field in the document by a wide margin. It's a box
// boundary, not a printed rule, so crossing it wouldn't cross printed text,
// but it's the first field that would show ink escaping its box if this
// constant or FONT_START_SIZE ever changed. Check it specifically before
// touching either.
function descenderDepth(font: PDFFont, size: number): number {
  return font.heightAtSize(size) - font.heightAtSize(size, { descender: false });
}
// Left inset for the For Official Use table's VALUE column, measured against
// the label column's own inset from the table's left border (label "Tier"
// starts 4.62pt right of the border at x=42.75) — the value previously
// started flush against the divider at x=143.04 with no inset at all.
const OFFICIAL_USE_LEFT_PAD = 6;
// The For Official Use rows have NO underline at all (defect 2 was the value
// missing its own row LABEL's baseline, not a rule) — these bypass the
// box-derived clearance above entirely via stampField's `baselineFromTop`
// override, using the label's OWN glyph baseline, measured directly (bottom-
// most dark pixel of "Tier", which has no descender, at 300dpi): Tier 1
// label baseline 738.48pt, Tier 2 label baseline 756.48pt (both top-left,
// page-relative — same space as AGREEMENT_FIELD_BOXES).
const TIER1_OFFICIAL_LABEL_BASELINE = 738.48;
const TIER2_OFFICIAL_LABEL_BASELINE = 756.48;
// signatureName/signatureNric have NO drawn rule at all (AGREEMENT_FIELD_RULE_Y
// confirms it — measured, not assumed, per Frontend's own original note).
// Aligned instead to the "Name:"/"NRIC No.:" LABELS' own printed baseline on
// the exact same line (pdftotext -bbox on the pristine master; neither label
// has a descender, so its own bbox bottom IS its baseline): "Name:" y=
// [398.86,408.83], "NRIC No.:" y=[408.86,418.83].
const SIGNATURE_NAME_LABEL_BASELINE = 408.83;
const SIGNATURE_NRIC_LABEL_BASELINE = 418.83;
// signedAtNote has no master rule to align to at all — it's our OWN placement
// in blank footer space (confirmed by the rule_y scan finding none there,
// matching DevLead's stated prediction), so there is no "measured" baseline
// to derive; this is simply where in the box we choose to put it. Computed
// the same way the old default fallback did (box.y+height, minus this box's
// own descender+clearance at FOOTER_FONT_SIZE), made explicit rather than
// left to a silent default now that stampField no longer has one.
const FOOTER_NOTE_BASELINE = 806.5;
// stampCircle's own pad, pulled out as a named constant: measured the actual
// gap available between "Yes"/"No" and the "/" between them (2.502pt) — the
// old inline 2.5pt pad put the ellipse's rightmost point AT the "/"'s own
// left edge (487.727 vs 487.729pt, functionally touching).
// 🔴 THE FACT THAT PRODUCED THREE WRONG FIGURES BEFORE IT WAS WRITTEN DOWN:
// `stampCircle`'s `borderWidth` (1.2) puts HALF its stroke width outside the
// mathematical path — so the visible ink-to-slash gap is always
// `CIRCLE_PAD − borderWidth/2` (0.6pt), never the pad value itself. Any
// future tuning of this constant must subtract that 0.6pt before comparing
// against a measured target, or the number quoted will be optimistic by
// half a stroke width — exactly the error made three times tonight before
// anyone wrote the subtraction down.
// Measured effect, ink-mask intersection against the master's own "/" glyph
// (Ghostscript-rendered, not poppler — poppler under-renders this specific
// stroke geometry and reported a false clean pass at a setting later found
// visibly touching). RESOLUTION MATTERS and cost real time before anyone
// wrote it down: a first measurement at pad=1.0, 300dpi (0.24pt/px), read
// 1.16pt/1.36pt clear — comfortably over the 1pt floor. Re-measured at
// 600dpi (0.12pt/px) and independently via a second rendering engine: BOTH
// read 0.96pt/1.08pt — identical to the digit, and UNDER the floor on the
// tighter side. The 300dpi figure was a quantisation artefact (both the
// ellipse edge and the slash edge round to the nearest coarse pixel,
// inflating the gap), not a second real measurement — so a prior claim
// that "0.8 and 1.0 measure identically, a plateau" was the same artefact
// and is retracted; there is no plateau.
// CIRCLE_PAD=0.6, verified at 600dpi with both instruments AND with the
// strictest ink threshold (any ink at all, not just majority-covered
// pixels): worst case 1.32pt, still clearing the 1pt floor with margin on
// every combination checked, not just the one first tried. Enclosure
// re-confirmed at the same resolution, BOTH axes (the ellipse must still
// contain its own word after shrinking the pad, not just clear the slash
// horizontally): Yes ellipse x=[469.44,486.36] y=[161.64,174.96] against
// its word at x=[470.64,484.80] y=[165.12,171.72]; No ellipse
// x=[491.76,506.28] against its word at x=[492.84,504.72] (same y) —
// comfortable, not marginal. The master's own gaps here are 3.00pt (Yes)
// and 2.76pt (No), so there's real headroom.
const CIRCLE_PAD = 0.6;

export type AgreementData = {
  fullName: string;
  designation: string;
  email: string;
  mobile: string;
  nricMasked?: string | null;
  teamName?: string | null;
  uplineName?: string | null;
  signedDate: Date;
  signatureDataUrl?: string | null; // PNG data URL
  // Official V.2026-04 particulars (filled where captured, else left blank —
  // the master's own printed blank line, never an invented placeholder).
  businessName?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  homeAddress?: string | null;
  religion?: string | null;
  commencementDate?: string | null;
  spouseConflict?: boolean | null;
  spouseName?: string | null;
  spouseCompany?: string | null;
  spouseDesignation?: string | null;
  emergencyName?: string | null;
  emergencyRelationship?: string | null;
  emergencyAddress?: string | null;
  emergencyContact?: string | null;
  associateId?: string | null;
  tier1Manager?: string | null;
  tier2Manager?: string | null;
};

/** "made on the __ day of __ 20__" parts, in Singapore time (the server
 *  clock may be UTC, which would give the wrong day for a signature made
 *  before 8am SGT). */
function agreementDateParts(date: Date): { day: string; month: string; yy: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", day: "numeric", month: "long", year: "numeric" })
    .formatToParts(date);
  const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  const n = Number(get("day"));
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return { day: `${n}${suffix}`, month: get("month"), yy: get("year").slice(2) };
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY" for any plain ISO date value on this form
 *  (date of birth, commencement date) — not a DOB-specific format. */
function fmtIsoDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/** Page 7 "For Official Use" Tier 1/2 Manager — Samuel's SCOPED exception:
 *  "NA" is stamped only here, and only for a genuinely absent upline (a
 *  known fact), never generalised to a field that's merely uncollected
 *  (those stay blank, per stampField's own null/undefined -> no-op rule). */
export function formatUplineOrNA(u: { fullName: string; associateCode: string } | null | undefined): string {
  return u ? `${u.fullName} (${u.associateCode})` : "NA";
}

function signedAtSgt(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date).replace(",", "");
}

/** Fit `text` on a SINGLE line inside `box`: shrink from FONT_START_SIZE
 *  down to FONT_MIN_SIZE looking for a width that fits; below the floor,
 *  ellipsis-truncate rather than shrink further or wrap.
 *
 *  Deliberately not multi-line: every box measured on this master (both
 *  Backend's and Frontend's passes) is a single printed row — the value's
 *  baseline is anchored to that row's own drawn underline, with only a
 *  couple of points of clearance above and below it, never a real second
 *  line's worth of clean vertical room. A wrap-then-shrink version of this
 *  function was tried and visually verified broken: on `emergencyContactAddress`
 *  (the narrowest, tallest-relative-to-need box we had), a wrapped second
 *  line's baseline landed past the row's own underline, and the printed
 *  rule struck straight through the second line's letters — confirmed on a
 *  4x crop, not inferred. Extending a box's height to make room for a
 *  second line doesn't help: the underline's position is fixed by the
 *  master regardless of how tall we declare the box, so a bottom-anchored
 *  multi-line block still crosses it. Truncating a too-long value to one
 *  legible line is a smaller, more honest defect than text visibly
 *  overlapping the document's own printed rule. */
/** Exported for direct boundary testing (agreement.test.ts) — the 4 shapes
 *  DevLead asked for (untouched / shrinks-to-exactly-minSize / truncates /
 *  degenerate single-char) depend on exact font metrics that are awkward to
 *  hit indirectly through a rendered PDF's pixels. */
export function fitText(
  font: PDFFont,
  text: string,
  box: FieldBox,
  startSize: number = FONT_START_SIZE,
  minSize: number = FONT_MIN_SIZE,
): { lines: string[]; size: number } {
  for (let size = startSize; size >= minSize; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= box.width) return { lines: [text], size };
  }
  const size = minSize;
  let truncated = text;
  while (truncated.length > 1 && font.widthOfTextAtSize(truncated + "…", size) > box.width) {
    truncated = truncated.slice(0, -1);
  }
  return { lines: [truncated + "…"], size };
}

/** Draw `value` into `box` (top-left origin) on `page`, bottom-aligned
 *  within the box like handwriting resting on the form's printed line.
 *  A null/blank value draws nothing — the master's own blank line stands,
 *  never an invented placeholder. */
/** Looks up a field's MEASURED rule position in AGREEMENT_FIELD_RULE_Y — the
 *  single source of truth, not a derived offset. Throws for a field with no
 *  measured rule (null/undefined in the table): those fields must pass an
 *  explicit `baselineFromTop` to stampField instead, never guess one via
 *  this helper. Fail-closed on purpose — a silent fallback here is exactly
 *  the shape of the original defect (assuming a rule position that was
 *  never actually measured). */
export function ruleOpts(fieldName: keyof typeof AGREEMENT_FIELD_BOXES): { ruleFromTop: number } {
  const ruleY = AGREEMENT_FIELD_RULE_Y[fieldName];
  if (ruleY == null) {
    throw new Error(
      `ruleOpts("${fieldName}"): no measured rule for this field (AGREEMENT_FIELD_RULE_Y is null/absent) — ` +
        `pass an explicit baselineFromTop instead of calling ruleOpts for it.`,
    );
  }
  return { ruleFromTop: ruleY };
}

function stampField(
  page: PDFPage,
  font: PDFFont,
  box: FieldBox,
  value: string | null | undefined,
  opts: { startSize?: number; minSize?: number; color?: ReturnType<typeof rgb>; leftPad?: number } & (
    | { ruleFromTop: number; baselineFromTop?: undefined }
    | { baselineFromTop: number; ruleFromTop?: undefined }
  ),
): void {
  const text = value?.trim();
  if (!text) return;
  const { lines, size } = fitText(font, text, box, opts.startSize, opts.minSize);
  const lineHeight = size * LINE_GAP;
  // Bottom-align the block of lines clear of the printed rule. Clearance is
  // DERIVED from this exact `size` (never a flat constant): the descender
  // that actually reaches below the baseline, plus the ink-to-rule gap
  // wanted. See BASELINE_INK_CLEARANCE's own comment for why.
  // `ruleFromTop` (from AGREEMENT_FIELD_RULE_Y, via ruleOpts) or an explicit
  // `baselineFromTop` is REQUIRED — no fallback to box.y+box.height. That
  // fallback was exactly the false premise behind the original defect (a
  // box's bottom edge is not necessarily its rule); every call site now
  // states its anchor explicitly instead of the box guessing one for it.
  const blockBottomFromTop =
    opts.baselineFromTop !== undefined ? opts.baselineFromTop : opts.ruleFromTop - (descenderDepth(font, size) + BASELINE_INK_CLEARANCE);
  const x = box.x + (opts.leftPad ?? 0);
  lines.slice().reverse().forEach((line, i) => {
    const baselineFromTop = blockBottomFromTop - i * lineHeight;
    page.drawText(line, { x, y: PAGE_SIZE.height - baselineFromTop, size, font, color: opts.color ?? INK });
  });
}

/** Draw an X inside a printed checkbox square. A checkbox that's simply not
 *  ticked draws nothing — same "no data, no mark" rule as a text field. */
function stampCheckbox(page: PDFPage, box: FieldBox): void {
  const pad = 3;
  const topY = PAGE_SIZE.height - box.y;
  const bottomY = PAGE_SIZE.height - (box.y + box.height);
  const left = box.x + pad;
  const right = box.x + box.width - pad;
  page.drawLine({ start: { x: left, y: topY - pad }, end: { x: right, y: bottomY + pad }, thickness: 1.2, color: INK });
  page.drawLine({ start: { x: right, y: topY - pad }, end: { x: left, y: bottomY + pad }, thickness: 1.2, color: INK });
}

/** Circle (never fill) whichever word applies, padded so the ellipse clears
 *  the glyphs rather than hugging them. Draws nothing for a null/undefined
 *  selection — same rule as every other blank; there is no "circle nothing"
 *  mark on the master, so an unknown answer must leave both words unmarked. */
function stampCircle(page: PDFPage, box: FieldBox): void {
  const pad = CIRCLE_PAD;
  const cx = box.x + box.width / 2;
  const cyFromTop = box.y + box.height / 2;
  page.drawEllipse({
    x: cx,
    y: PAGE_SIZE.height - cyFromTop,
    xScale: box.width / 2 + pad,
    yScale: box.height / 2 + pad,
    borderColor: INK,
    borderWidth: 1.2,
  });
}

async function stampSignatureImage(pdfDoc: PDFDocument, page: PDFPage, box: FieldBox, dataUrl: string): Promise<void> {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) return; // caller already validates this is a PNG data URL before render; a mismatch here just leaves the line blank
  const bytes = Buffer.from(m[1], "base64");
  const img = await pdfDoc.embedPng(bytes);
  const scale = Math.min(box.width / img.width, box.height / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = box.x + (box.width - w) / 2;
  const yFromTop = box.y + (box.height - h) / 2;
  page.drawImage(img, { x, y: PAGE_SIZE.height - yFromTop - h, width: w, height: h });
}

export async function renderAgreementPdf(a: AgreementData): Promise<Buffer> {
  const masterBytes = readFileSync(join(process.cwd(), MASTER_TEMPLATE_PATH));
  assertMasterTemplateSha256(masterBytes);

  const pdfDoc = await PDFDocument.load(masterBytes);
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const pageOf = (n: number): PDFPage => pdfDoc.getPage(n - 1);

  const made = agreementDateParts(a.signedDate);
  stampField(pageOf(AGREEMENT_FIELD_BOXES.madeDay.page), font, AGREEMENT_FIELD_BOXES.madeDay, made.day, ruleOpts("madeDay"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.madeMonth.page), font, AGREEMENT_FIELD_BOXES.madeMonth, made.month, ruleOpts("madeMonth"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.madeYearYY.page), font, AGREEMENT_FIELD_BOXES.madeYearYY, made.yy, ruleOpts("madeYearYY"));

  stampField(pageOf(AGREEMENT_FIELD_BOXES.fullName.page), font, AGREEMENT_FIELD_BOXES.fullName, a.fullName, ruleOpts("fullName"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.businessName.page), font, AGREEMENT_FIELD_BOXES.businessName, a.businessName, ruleOpts("businessName"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.nricMasked.page), font, AGREEMENT_FIELD_BOXES.nricMasked, a.nricMasked, ruleOpts("nricMasked"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.nationality.page), font, AGREEMENT_FIELD_BOXES.nationality, a.nationality, ruleOpts("nationality"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.dateOfBirth.page), font, AGREEMENT_FIELD_BOXES.dateOfBirth, fmtIsoDate(a.dateOfBirth), ruleOpts("dateOfBirth"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.gender.page), font, AGREEMENT_FIELD_BOXES.gender, a.gender, ruleOpts("gender"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.maritalStatus.page), font, AGREEMENT_FIELD_BOXES.maritalStatus, a.maritalStatus, ruleOpts("maritalStatus"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.homeAddress.page), font, AGREEMENT_FIELD_BOXES.homeAddress, a.homeAddress, ruleOpts("homeAddress"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.mobile.page), font, AGREEMENT_FIELD_BOXES.mobile, a.mobile, ruleOpts("mobile"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.religion.page), font, AGREEMENT_FIELD_BOXES.religion, a.religion, ruleOpts("religion"));

  // signatureName/signatureNric: no drawn rule at all (measured — see
  // AGREEMENT_FIELD_RULE_Y) — aligned to their own printed labels' baseline.
  stampField(pageOf(AGREEMENT_FIELD_BOXES.signatureName.page), font, AGREEMENT_FIELD_BOXES.signatureName, a.fullName, { baselineFromTop: SIGNATURE_NAME_LABEL_BASELINE });
  stampField(pageOf(AGREEMENT_FIELD_BOXES.signatureNric.page), font, AGREEMENT_FIELD_BOXES.signatureNric, a.nricMasked, { baselineFromTop: SIGNATURE_NRIC_LABEL_BASELINE });
  // Samuel's ruling: relocated to the page-7 footer, clear of "Page 7 of 7 /
  // V.2026-04" and the For Official Use table, in the master's own small
  // grey footer style — see FOOTER_GREY/FOOTER_FONT_SIZE and the box's own
  // derivation comment in associate-agreement-coordinates.ts. No master rule
  // to align to (measured — see AGREEMENT_FIELD_RULE_Y); FOOTER_NOTE_BASELINE
  // is our own chosen placement, made explicit.
  stampField(
    pageOf(AGREEMENT_FIELD_BOXES.signedAtNote.page), font, AGREEMENT_FIELD_BOXES.signedAtNote,
    `Signed ${signedAtSgt(a.signedDate)} via the Enshrine Virtual Office onboarding portal.`,
    { startSize: FOOTER_FONT_SIZE, minSize: 6, color: FOOTER_GREY, baselineFromTop: FOOTER_NOTE_BASELINE },
  );

  // ---- Page 7 (b): commencement — 2 checkboxes + 1 date blank. A set
  // commencementDate means "On <date>"; none means "Immediate" — the
  // form's only other option. Never both, never neither.
  if (a.commencementDate) {
    stampCheckbox(pageOf(AGREEMENT_FIELD_BOXES.commencementOnCheckbox.page), AGREEMENT_FIELD_BOXES.commencementOnCheckbox);
    stampField(
      pageOf(AGREEMENT_FIELD_BOXES.commencementOnDate.page), font, AGREEMENT_FIELD_BOXES.commencementOnDate,
      fmtIsoDate(a.commencementDate), ruleOpts("commencementOnDate"),
    );
  } else {
    stampCheckbox(pageOf(AGREEMENT_FIELD_BOXES.commencementImmediateCheckbox.page), AGREEMENT_FIELD_BOXES.commencementImmediateCheckbox);
  }

  // ---- Page 7 (b): spouse conflict-of-interest. Text fields pass through
  // whatever the caller sends (already gated to null-unless-declared at the
  // call site); the Yes/No selector is drawn as a circle, never text — the
  // master has no blank there, only static "Yes / No" for a human to mark.
  stampField(pageOf(AGREEMENT_FIELD_BOXES.spouseName.page), font, AGREEMENT_FIELD_BOXES.spouseName, a.spouseName, ruleOpts("spouseName"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.spouseCompanyName.page), font, AGREEMENT_FIELD_BOXES.spouseCompanyName, a.spouseCompany, ruleOpts("spouseCompanyName"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.spouseDesignation.page), font, AGREEMENT_FIELD_BOXES.spouseDesignation, a.spouseDesignation, ruleOpts("spouseDesignation"));
  if (a.spouseConflict === true) {
    stampCircle(pageOf(AGREEMENT_FIELD_BOXES.spouseWorkingYes.page), AGREEMENT_FIELD_BOXES.spouseWorkingYes);
  } else if (a.spouseConflict === false) {
    stampCircle(pageOf(AGREEMENT_FIELD_BOXES.spouseWorkingNo.page), AGREEMENT_FIELD_BOXES.spouseWorkingNo);
  } // null/undefined: circle neither — same "no data, no mark" rule as everything else.

  // ---- Page 7 (c): emergency contact.
  stampField(pageOf(AGREEMENT_FIELD_BOXES.emergencyContactName.page), font, AGREEMENT_FIELD_BOXES.emergencyContactName, a.emergencyName, ruleOpts("emergencyContactName"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.emergencyContactRelationship.page), font, AGREEMENT_FIELD_BOXES.emergencyContactRelationship, a.emergencyRelationship, ruleOpts("emergencyContactRelationship"));
  // emergencyContactAddress: the field Samuel's truncation ruling is about —
  // now has a real measured rule (shares emergencyContactNumber's, same row).
  stampField(pageOf(AGREEMENT_FIELD_BOXES.emergencyContactAddress.page), font, AGREEMENT_FIELD_BOXES.emergencyContactAddress, a.emergencyAddress, ruleOpts("emergencyContactAddress"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.emergencyContactNumber.page), font, AGREEMENT_FIELD_BOXES.emergencyContactNumber, a.emergencyContact, ruleOpts("emergencyContactNumber"));

  // ---- Page 7: For Official Use. Associate ID is deliberately NEVER
  // stamped, on any call — Samuel's ruling: the signed PDF is never
  // modified after signing, and the code doesn't exist until approval runs
  // (nextAssociateCode() is called inside approveCandidate). No caller
  // should be passing a.associateId here; there is no branch that reads it
  // at all, so a caller that does pass one has no effect on the signed copy.
  stampField(
    pageOf(AGREEMENT_FIELD_BOXES.tier1ManagerOfficial.page), font, AGREEMENT_FIELD_BOXES.tier1ManagerOfficial, a.tier1Manager,
    { leftPad: OFFICIAL_USE_LEFT_PAD, baselineFromTop: TIER1_OFFICIAL_LABEL_BASELINE },
  );
  stampField(
    pageOf(AGREEMENT_FIELD_BOXES.tier2ManagerOfficial.page), font, AGREEMENT_FIELD_BOXES.tier2ManagerOfficial, a.tier2Manager,
    { leftPad: OFFICIAL_USE_LEFT_PAD, baselineFromTop: TIER2_OFFICIAL_LABEL_BASELINE },
  );

  if (a.signatureDataUrl) {
    await stampSignatureImage(pdfDoc, pageOf(AGREEMENT_FIELD_BOXES.signatureImage.page), AGREEMENT_FIELD_BOXES.signatureImage, a.signatureDataUrl);
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
