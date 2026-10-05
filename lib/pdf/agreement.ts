import { readFileSync } from "fs";
import { join } from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { PNG } from "pngjs";
import {
  MASTER_TEMPLATE_PATH,
  PAGE_SIZE,
  AGREEMENT_FIELD_BOXES,
  AGREEMENT_FIELD_RULE_Y,
  AGREEMENT_CIRCLE_WORD_INK,
  assertMasterTemplateSha256,
  type FieldBox,
} from "@/lib/pdf/associate-agreement-coordinates";

// ---------------------------------------------------------------------------
// Associate Agreement — stamp values onto the master PDF, verbatim, rather
// than re-typesetting it. The owner's requirement is that the signed document
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
// The official-use rows sit on an 18pt pitch and each value ALIGNS TO ITS OWN
// LABEL's baseline, not to the row's divider rule (see the correction note in
// associate-agreement-coordinates.ts): 720.48, 738.48, 756.48. The associate-ID
// row is the first of the three, so its label baseline is one pitch above
// tier 1's. Verified on a real render, not assumed: the stamped text is asserted
// to land inside associateIdOfficial's own measured box.
const ASSOCIATE_ID_OFFICIAL_LABEL_BASELINE = 720.48;
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
// `stampCircle`'s ellipse is built from the word's own measured ink extents
// (AGREEMENT_CIRCLE_WORD_INK), not the field box: semi-axis = half the ink
// extent on that axis, plus a pad. Three pads, not one:
//
// The horizontal pad is split into two, because the two sides of each word
// face different constraints: the "/" divider sits close on one side (the
// side facing the OTHER word) and bounds that pad tightly, while the far
// side has no such neighbour and can take much more room without touching
// anything — a single shared horizontal pad forces both sides to the
// tighter figure, which is why the ellipse used to read as barely clearing
// the word rather than sitting around it with visible space. `stampCircle`
// takes which side faces the divider per call (Yes's divider-side is its
// right; No's is its left) and applies CIRCLE_PAD_HORIZONTAL_INNER there,
// CIRCLE_PAD_HORIZONTAL_OUTER on the far side — shifting the ellipse's
// centre off the word's own geometric centre, not just widening it.
//
// The vertical pad is unchanged in kind (one shared value, both axes
// symmetric) — the word's ink is much wider than tall (Yes: ~7pt half-width
// vs ~3.3pt half-height), and full vertical enclosure of the letterforms
// needs meaningfully more room than the horizontal inner pad allows, so it
// cannot simply reuse that figure either.
//
// The drawn stroke (borderWidth below) extends half its width outside the
// mathematical ellipse path, so the real outer reach on an axis is
// `halfExtent + pad + borderWidth/2` — clearance to a neighbour is measured
// from THAT edge, never from the pad value alone.
// Verified by rendering (Ghostscript, 1200dpi minimum for any figure judged
// against the 1pt floor — 600dpi is one order of magnitude coarser than the
// sub-0.1pt differences these figures turn on, and produced a non-monotonic,
// clearly-quantised table before this exact case forced the move to 1200dpi)
// and intersecting two independently measured ink masks (the stroke's own
// ink vs the neighbouring glyph's own ink), never a with/without
// differential. Both the shipped intersection test's zero-overlap check
// AND a separate, finer-grid distance measurement against the 1pt floor
// itself clear it on the tighter word at every grid tested: 1.130pt
// clearance at 600dpi, 1.101pt at 2400dpi — comfortable margin there — but
// only 1.051pt at 1200dpi, a single 1200dpi grid step (0.06pt) above the
// floor, stated exactly rather than rounded up to "ample" (a smaller inner
// pad than an earlier candidate bought this back from sitting BELOW the
// floor; see reviews/ for the full table and why the inner pad, not the
// outer one, is the lever for this). Word-
// enclosure has no stated floor but is re-confirmed at zero overlap, both
// axes, at 600/1200/2400dpi for the values actually shipped, since a margin
// that reads clear at one grid is not guaranteed to still be clear at a
// finer one (measured directly on this exact geometry, not a general
// worry) — re-verify all three whenever any pad changes.
//
// Exported (not just module-local consts) so the dedicated ink-mask
// intersection test (agreement-circle-ink-intersection.integration.test.ts) always
// verifies the REAL production values — a hardcoded copy in a test file
// would silently stop tracking a constant the moment it changed.
export const CIRCLE_PAD_HORIZONTAL_INNER = 0.90;
export const CIRCLE_PAD_HORIZONTAL_OUTER = 2.5;
export const CIRCLE_PAD_VERTICAL = 9.0;
// companySignatoryName: like signedAtNote, there is no printed master rule
// or label at all — the "SIGNED by the Abovementioned Company" block (page 7,
// y=[328.86,348.83], pdftotext -bbox) has no "Name:" sub-line the way the
// associate block does (y=[398.86,408.83]), so this is entirely our own
// placement in the blank space between that block and the associate block
// below it (y=[378.86,...]). Same convention as SIGNATURE_NAME_LABEL_BASELINE:
// baseline sits 0.2pt above the name box's own bottom edge (see
// companySignatoryName in associate-agreement-coordinates.ts, y=360+14.9).
const COMPANY_SIGNATORY_NAME_BASELINE = 374.7;

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
  // CR-0001: the company's own signatory, stamped into the "SIGNED by the
  // Abovementioned Company" block. The caller passes the SNAPSHOT taken at
  // signing (CompanySignatory.*AtSigning on the row being rendered), never a
  // live CompanySignatory read, except at the one moment signing itself
  // happens — see server/recruitment/actions.ts. A later change to the
  // company's signatory must never alter an already-signed agreement.
  companySignatoryName?: string | null;
  companySignatureDataUrl?: string | null; // PNG data URL, same convention as signatureDataUrl
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

/** Page 7 "For Official Use" Tier 1/2 Manager — the owner's SCOPED exception:
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
/** Exported for direct boundary testing (agreement.integration.test.ts) — the 4 shapes
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

/** Would `value` be truncated on the signed agreement's `homeAddress` box?
 *  Reuses `fitText` against the SAME box and font the renderer stamps with —
 *  one source of truth, no hard-coded character count. Embeds a throwaway
 *  `PDFDocument` purely to get the real font metrics; nothing is rendered or
 *  kept. Callers should bound input length themselves before calling this
 *  (each call embeds and measures) — it does not bound it internally. */
export async function wouldTruncate(value: string): Promise<boolean> {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const { lines } = fitText(font, trimmed, AGREEMENT_FIELD_BOXES.homeAddress);
  return lines[0] !== trimmed;
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

/** Circle (never fill) whichever word applies, sized from that word's own
 *  measured ink extents (`ink`, from AGREEMENT_CIRCLE_WORD_INK) rather than
 *  its field box, padded so the ellipse clears the glyphs rather than
 *  hugging them. `dividerSide` is which side of THIS word's own ink the "/"
 *  divider sits on — that side gets CIRCLE_PAD_HORIZONTAL_INNER (held to
 *  the 1pt clearance floor), the far side gets CIRCLE_PAD_HORIZONTAL_OUTER
 *  (room to spare, no such neighbour) — an asymmetric ellipse, centred off
 *  the word's own geometric centre, not just a wider symmetric one. Draws
 *  nothing for a null/undefined selection — same rule as every other blank;
 *  there is no "circle nothing" mark on the master, so an unknown answer
 *  must leave both words unmarked. */
function stampCircle(
  page: PDFPage,
  ink: { minX: number; minY: number; maxX: number; maxY: number },
  dividerSide: "left" | "right",
): void {
  const leftPad = dividerSide === "left" ? CIRCLE_PAD_HORIZONTAL_INNER : CIRCLE_PAD_HORIZONTAL_OUTER;
  const rightPad = dividerSide === "right" ? CIRCLE_PAD_HORIZONTAL_INNER : CIRCLE_PAD_HORIZONTAL_OUTER;
  const x0 = ink.minX - leftPad;
  const x1 = ink.maxX + rightPad;
  const cx = (x0 + x1) / 2;
  const cyFromTop = (ink.minY + ink.maxY) / 2;
  const halfH = (ink.maxY - ink.minY) / 2;
  page.drawEllipse({
    x: cx,
    y: PAGE_SIZE.height - cyFromTop,
    xScale: (x1 - x0) / 2,
    yScale: halfH + CIRCLE_PAD_VERTICAL,
    borderColor: INK,
    borderWidth: 1.2,
  });
}

// Crop a PNG to the bounding box of its visible ink (non-transparent, non-near-white
// pixels), so a signature drawn anywhere in the pad canvas is reduced to just the
// strokes. Returns the ORIGINAL bytes unchanged if the image has no ink (fully
// transparent/blank) or is already tight — never throws, never returns an empty image.
function trimPngToInk(bytes: Buffer): Buffer {
  let png: PNG;
  try {
    png = PNG.sync.read(bytes);
  } catch {
    return bytes; // undecodable here → let embedPng handle the original
  }
  const { width, height, data } = png;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] <= 16) continue; // transparent
      if (data[i] + data[i + 1] + data[i + 2] >= 735) continue; // near-white (3×245)
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return bytes; // no ink at all → untrimmed fallback
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  if (cw === width && ch === height) return bytes; // already tight
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((minY + y) * width + (minX + x)) * 4;
      const di = (y * cw + x) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return PNG.sync.write(out);
}

async function stampSignatureImage(pdfDoc: PDFDocument, page: PDFPage, box: FieldBox, dataUrl: string, align: "center" | "left" = "center"): Promise<void> {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) return; // caller already validates this is a PNG data URL before render; a mismatch here just leaves the line blank
  // align="left": trim the signature's whitespace first so the INK (not the padded
  // canvas) shares the printed name's left margin at box.x, for any aspect ratio.
  // Trim-then-fit also normalises size — a small/cornered signature scales up to the
  // box. Default "center" skips the trim and keeps the associate block byte-identical.
  let bytes: Buffer = Buffer.from(m[1], "base64");
  if (align === "left") bytes = trimPngToInk(bytes);
  const img = await pdfDoc.embedPng(bytes);
  const scale = Math.min(box.width / img.width, box.height / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = align === "left" ? box.x : box.x + (box.width - w) / 2;
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
  // Owner ruling: relocated to the page-7 footer, clear of "Page 7 of 7 /
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
    // The "/" divider sits to the RIGHT of "Yes" — that's its divider side.
    stampCircle(pageOf(AGREEMENT_FIELD_BOXES.spouseWorkingYes.page), AGREEMENT_CIRCLE_WORD_INK.spouseWorkingYes, "right");
  } else if (a.spouseConflict === false) {
    // The "/" divider sits to the LEFT of "No" — that's its divider side.
    stampCircle(pageOf(AGREEMENT_FIELD_BOXES.spouseWorkingNo.page), AGREEMENT_CIRCLE_WORD_INK.spouseWorkingNo, "left");
  } // null/undefined: circle neither — same "no data, no mark" rule as everything else.

  // ---- Page 7 (c): emergency contact.
  stampField(pageOf(AGREEMENT_FIELD_BOXES.emergencyContactName.page), font, AGREEMENT_FIELD_BOXES.emergencyContactName, a.emergencyName, ruleOpts("emergencyContactName"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.emergencyContactRelationship.page), font, AGREEMENT_FIELD_BOXES.emergencyContactRelationship, a.emergencyRelationship, ruleOpts("emergencyContactRelationship"));
  // emergencyContactAddress: the field the owner's truncation ruling is about —
  // now has a real measured rule (shares emergencyContactNumber's, same row).
  stampField(pageOf(AGREEMENT_FIELD_BOXES.emergencyContactAddress.page), font, AGREEMENT_FIELD_BOXES.emergencyContactAddress, a.emergencyAddress, ruleOpts("emergencyContactAddress"));
  stampField(pageOf(AGREEMENT_FIELD_BOXES.emergencyContactNumber.page), font, AGREEMENT_FIELD_BOXES.emergencyContactNumber, a.emergencyContact, ruleOpts("emergencyContactNumber"));

  // ---- Page 7: For Official Use.
  //
  // Associate ID is now stamped. It was withheld for two reasons, and only one
  // of them has changed: the code did not exist until approveCandidate ran
  // (the owner has ruled that it is allocated earlier, at signing, so it now
  // does), and the signed PDF is never modified after signing (unchanged, and
  // the reason this has to be stamped on the ORIGINAL render rather than added
  // to a signed document later). An absent value still renders nothing, so a
  // caller with no code — a preview, or a candidate row predating the
  // reservation column — leaves the box blank exactly as before.
  stampField(
    pageOf(AGREEMENT_FIELD_BOXES.associateIdOfficial.page), font, AGREEMENT_FIELD_BOXES.associateIdOfficial, a.associateId ?? null,
    { leftPad: OFFICIAL_USE_LEFT_PAD, baselineFromTop: ASSOCIATE_ID_OFFICIAL_LABEL_BASELINE },
  );
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

  // CR-0001: the company's own signature + printed name, right of the
  // "SIGNED by the Abovementioned Company )" bracket — same convention as
  // the associate's own signature block above, stamped independently (a
  // candidate who hasn't been given a signature image yet, or a signatory
  // with no stored name, still gets whichever half is present).
  if (a.companySignatureDataUrl) {
    await stampSignatureImage(pdfDoc, pageOf(AGREEMENT_FIELD_BOXES.companySignatureImage.page), AGREEMENT_FIELD_BOXES.companySignatureImage, a.companySignatureDataUrl, "left");
  }
  stampField(
    pageOf(AGREEMENT_FIELD_BOXES.companySignatoryName.page), font, AGREEMENT_FIELD_BOXES.companySignatoryName, a.companySignatoryName,
    { baselineFromTop: COMPANY_SIGNATORY_NAME_BASELINE },
  );

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
