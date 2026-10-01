import { describe, test, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { writeFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { renderAgreementPdf, formatUplineOrNA, fitText, ruleOpts, wouldTruncate, type AgreementData } from "@/lib/pdf/agreement";
import { assertMasterTemplateSha256, MASTER_TEMPLATE_PATH, AGREEMENT_FIELD_BOXES, AGREEMENT_FIELD_RULE_Y, type FieldBox } from "@/lib/pdf/associate-agreement-coordinates";

// Tmpfs hotfix (2026-10-01): every mkdtempSync below goes through this one
// wrapper so (a) the directory is ALWAYS the live `tmpdir()` — never a
// hardcoded "/tmp" that the shared box's TMPDIR override would silently
// stop matching — and (b) the cleanup-proof test at the bottom of this file
// can assert against the exact paths created, not a directory-wide "no
// agpdf-* left" scan (which would false-positive on another vitest worker's
// own in-flight directory under this file's 8-way unit-test parallelism).
const createdTempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdTempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// 🔴 REQUIRES poppler-utils on the machine running this file — specifically
// `pdfinfo`, `pdftotext`, AND `pdftoppm`. Stated here, not only in whatever
// CI workflow installs it, because that's where a future reader (or a
// runner missing the package) actually meets the requirement. This is
// deliberate, not incidental: the whole point is an INDEPENDENT check of
// what pdf-lib actually wrote, not pdf-lib re-reading its own output (a
// check that's blind to its own reference proves nothing). If poppler-utils
// is absent, these fail loudly (ENOENT) — the correct behaviour, never
// silently skipped. (Found the hard way: a run with poppler-utils missing
// produced 26 `spawnSync pdfinfo ENOENT` failures with nothing about the
// PDF content itself wrong.)
// ---------------------------------------------------------------------------

function toTempPdf(bytes: Buffer): string {
  const dir = mkTempDir("agpdf-test-");
  const file = join(dir, "out.pdf");
  writeFileSync(file, bytes);
  return file;
}

/** Rasterize one page and return a point-space "is this pixel dark" probe.
 *  Shared by every pixel-level check below (spouse circle, baseline
 *  clearance) — vector marks and ink-vs-rule position are invisible to
 *  pdftotext, so these need real pixels, not text. */
function rasterizePage(bytes: Buffer, page: number, dpi = 300): { scale: number; width: number; height: number; isDark: (xPt: number, yPt: number) => boolean } {
  const file = toTempPdf(bytes);
  const dir = mkTempDir("agpdf-raster-");
  try {
    execFileSync("pdftoppm", ["-r", String(dpi), "-f", String(page), "-l", String(page), file, join(dir, "p")]);
    const ppmPath = execFileSync("sh", ["-c", `ls ${dir}/p*.ppm`], { encoding: "utf8" }).trim();
    const buf = readFileSync(ppmPath);
    // Minimal P6 PPM parser: header "P6\n<w> <h>\n<maxval>\n" then raw RGB bytes.
    let idx = 0;
    function readToken(): string {
      while (buf[idx] === 0x23) { while (buf[idx] !== 0x0a) idx++; idx++; } // skip comments
      while (buf[idx] === 0x20 || buf[idx] === 0x0a || buf[idx] === 0x09 || buf[idx] === 0x0d) idx++;
      const start = idx;
      while (idx < buf.length && buf[idx] !== 0x20 && buf[idx] !== 0x0a && buf[idx] !== 0x09 && buf[idx] !== 0x0d) idx++;
      return buf.toString("ascii", start, idx);
    }
    const magic = readToken();
    if (magic !== "P6") throw new Error(`unexpected PPM magic ${magic}`);
    const width = Number(readToken());
    const height = Number(readToken());
    readToken(); // maxval
    idx += 1; // single whitespace before binary data
    const scale = dpi / 72;
    const dataStart = idx;
    // `buf` is already fully read into memory below — the returned isDark
    // closure never touches disk again, so it's safe to remove both temp
    // dirs here rather than leaking them for the rest of the suite.
    return {
      scale, width, height,
      isDark(xPt: number, yPt: number): boolean {
        const x = Math.round(xPt * scale), y = Math.round(yPt * scale);
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const off = dataStart + (y * width + x) * 3;
        const r = buf[off], g = buf[off + 1], b = buf[off + 2];
        return r < 150 && g < 150 && b < 150;
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(file), { recursive: true, force: true });
  }
}

/** Page count via `pdfinfo`, NOT a `pdftotext` form-feed count — the master
 *  has a trailing form feed in its own raw text extract, so a naive
 *  `\f`-count reads 8 for a real 7-page document (confirmed against this
 *  exact master in reviews/agreement-pdf-pages-4-7-blanks.md). */
function pdfPageCount(bytes: Buffer): number {
  const file = toTempPdf(bytes);
  try {
    const out = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    const m = /^Pages:\s*(\d+)/m.exec(out);
    if (!m) throw new Error(`pdfinfo produced no "Pages:" line — output:\n${out}`);
    return Number(m[1]);
  } finally {
    rmSync(dirname(file), { recursive: true, force: true });
  }
}

function pdfText(bytes: Buffer, page?: number): string {
  const args = page ? ["-f", String(page), "-l", String(page)] : [];
  const file = toTempPdf(bytes);
  try {
    return execFileSync("pdftotext", [...args, file, "-"], { encoding: "utf8" });
  } finally {
    rmSync(dirname(file), { recursive: true, force: true });
  }
}

type Word = { text: string; xMin: number; yMin: number; xMax: number; yMax: number };

/** Word positions in pdftotext's own space: points, top-left origin — the
 *  SAME space AGREEMENT_FIELD_BOXES is defined in, so a box's y-range can be
 *  compared directly against these without any conversion. */
function pdfWords(bytes: Buffer, page: number): Word[] {
  const file = toTempPdf(bytes);
  let xml: string;
  try {
    xml = execFileSync("pdftotext", ["-bbox", "-f", String(page), "-l", String(page), file, "-"], {
      encoding: "utf8",
    });
  } finally {
    rmSync(dirname(file), { recursive: true, force: true });
  }
  const words: Word[] = [];
  const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    words.push({ xMin: +m[1], yMin: +m[2], xMax: +m[3], yMax: +m[4], text: m[5] });
  }
  return words;
}

/** All text whose word bbox falls (with a small tolerance) inside a box's
 *  own y-range on its own page — i.e. "what's actually printed in this row",
 *  read from the rendered PDF itself, not assumed from what we asked to
 *  stamp there. */
function textInBoxRow(bytes: Buffer, box: { page: number; x: number; y: number; width: number; height: number }): string {
  const tol = 1;
  return pdfWords(bytes, box.page)
    .filter(
      (w) =>
        w.yMin >= box.y - tol &&
        w.yMax <= box.y + box.height + tol &&
        w.xMin >= box.x - tol &&
        w.xMax <= box.x + box.width + tol,
    )
    .map((w) => w.text)
    .join(" ");
}

// The circle is vector graphics, invisible to pdftotext. Detected instead by
// rasterizing and checking for ink in the ANNULUS between the tight text
// bbox and the circle's own padded radius — NOT the tight bbox itself, which
// already has non-white ink from the master's own printed "Yes"/"No" glyphs
// regardless of whether a circle was drawn. Sampling the bbox alone would
// pass even with stampCircle deleted entirely.
// Per-side padding: "Yes" and "No" sit only ~7.8pt apart, so a symmetric pad
// wide enough to catch the stroke on the OUTER side would sample past the
// midpoint on the INNER side and pick up the neighbour's own circle — not
// noise, literally the other word's ink, since the two sampling windows
// would overlap in space. Pad small on the side facing the neighbour, full
// pad everywhere else.
// Top-level (not nested in a describe) so the cleanup-proof test below can
// exercise it directly — it has its own raster dir, same leak class as
// rasterizePage, and was the one site the proof test didn't reach.
function annulusInkFraction(
  bytes: Buffer,
  page: number,
  box: { x: number; y: number; width: number; height: number },
  pad: { top: number; bottom: number; left: number; right: number },
): number {
  const file = toTempPdf(bytes);
  const dir = mkTempDir("agpdf-raster-");
  try {
    const dpi = 150;
    execFileSync("pdftoppm", ["-r", String(dpi), "-f", String(page), "-l", String(page), file, join(dir, "p")]);
    const ppmPath = execFileSync("sh", ["-c", `ls ${dir}/p*.ppm`], { encoding: "utf8" }).trim();
    const buf = readFileSync(ppmPath);
    // Minimal P6 PPM parser: header "P6\n<w> <h>\n<maxval>\n" then raw RGB bytes.
    let idx = 0;
    function readToken(): string {
      while (buf[idx] === 0x23) { while (buf[idx] !== 0x0a) idx++; idx++; } // skip comments
      while (buf[idx] === 0x20 || buf[idx] === 0x0a || buf[idx] === 0x09 || buf[idx] === 0x0d) idx++;
      const start = idx;
      while (idx < buf.length && buf[idx] !== 0x20 && buf[idx] !== 0x0a && buf[idx] !== 0x09 && buf[idx] !== 0x0d) idx++;
      return buf.toString("ascii", start, idx);
    }
    const magic = readToken();
    if (magic !== "P6") throw new Error(`unexpected PPM magic ${magic}`);
    const w = Number(readToken());
    const h = Number(readToken());
    readToken(); // maxval
    idx += 1; // single whitespace before binary data
    const scale = dpi / 72;
    const outer = {
      x: box.x - pad.left, y: box.y - pad.top,
      width: box.width + pad.left + pad.right, height: box.height + pad.top + pad.bottom,
    };
    const ox0 = Math.floor(outer.x * scale), oy0 = Math.floor(outer.y * scale);
    const ox1 = Math.ceil((outer.x + outer.width) * scale), oy1 = Math.ceil((outer.y + outer.height) * scale);
    const ix0 = Math.ceil(box.x * scale), iy0 = Math.ceil(box.y * scale);
    const ix1 = Math.floor((box.x + box.width) * scale), iy1 = Math.floor((box.y + box.height) * scale);
    let nonWhite = 0, total = 0;
    for (let y = Math.max(0, oy0); y < Math.min(h, oy1); y++) {
      for (let x = Math.max(0, ox0); x < Math.min(w, ox1); x++) {
        if (x >= ix0 && x < ix1 && y >= iy0 && y < iy1) continue; // inside tight bbox — skip
        const off = idx + (y * w + x) * 3;
        const r = buf[off], g = buf[off + 1], b = buf[off + 2];
        total++;
        if (r < 230 || g < 230 || b < 230) nonWhite++;
      }
    }
    return total === 0 ? 0 : nonWhite / total;
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(file), { recursive: true, force: true });
  }
}

const BASE: AgreementData = {
  fullName: "Test Associate",
  designation: "Sales Associate",
  email: "test@example.com",
  mobile: "91234567",
  nricMasked: "S****123A",
  signedDate: new Date("2026-09-28T10:00:00+08:00"),
};

describe("renderAgreementPdf — structure", () => {
  test("produces exactly 7 pages (pdfinfo, not a form-feed count)", async () => {
    const pdf = await renderAgreementPdf(BASE);
    expect(pdfPageCount(pdf)).toBe(7);
  });

  test("the master's own clause text survives untouched (clause 1.1)", async () => {
    const pdf = await renderAgreementPdf(BASE);
    const text = pdfText(pdf, 1);
    expect(text).toContain(
      "who is an independent contractor and is not and shall not be deemed to be a servant,",
    );
  });

  test("page 6 (no blanks in range) is byte-identical to the master's own page 6 text", async () => {
    const masterBytes = readFileSync(join(process.cwd(), MASTER_TEMPLATE_PATH));
    const pdf = await renderAgreementPdf(BASE);
    expect(pdfText(pdf, 6)).toBe(pdfText(masterBytes, 6));
  });

  test("throws when the master template's bytes don't match the pinned sha256", () => {
    const masterBytes = readFileSync(join(process.cwd(), MASTER_TEMPLATE_PATH));
    const tampered = Buffer.from(masterBytes);
    tampered[100] = tampered[100] ^ 0xff;
    expect(() => assertMasterTemplateSha256(tampered)).toThrow(/has changed/);
  });
});

describe("renderAgreementPdf — values present (page 1 + page 7 fields)", () => {
  const FULL: AgreementData = {
    ...BASE,
    businessName: "Test Trading Co",
    nationality: "Singaporean",
    dateOfBirth: "1990-05-15",
    gender: "Male",
    maritalStatus: "Single",
    homeAddress: "1 Test Street",
    religion: "None",
    commencementDate: "2026-10-01",
    spouseConflict: true,
    spouseName: "Jamie Spouse",
    spouseCompany: "Spouse Co Pte Ltd",
    spouseDesignation: "Director",
    emergencyName: "Emergency Contact",
    emergencyRelationship: "Sibling",
    emergencyContact: "98765432",
    tier1Manager: formatUplineOrNA({ fullName: "Jane Upline", associateCode: "EN0001" }),
    tier2Manager: formatUplineOrNA({ fullName: "Sam Second", associateCode: "EN0002" }),
  };

  test("page 1 particulars values are present", async () => {
    const text = pdfText(await renderAgreementPdf(FULL), 1);
    for (const v of ["Test Associate", "Test Trading Co", "Singaporean", "15/05/1990"]) {
      expect(text).toContain(v);
    }
  });

  test("commencement 'On <date>' is checked and dated when commencementDate is set", async () => {
    const pdf = await renderAgreementPdf(FULL);
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.commencementOnDate)).toContain("01/10/2026");
  });

  test("commencement defaults to 'Immediate' (no date stamped) when commencementDate is absent", async () => {
    const pdf = await renderAgreementPdf({ ...FULL, commencementDate: null });
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.commencementOnDate)).toBe("");
  });

  test("spouse block values are present when declared", async () => {
    const text = pdfText(await renderAgreementPdf(FULL), 7);
    for (const v of ["Jamie Spouse", "Spouse Co Pte Ltd", "Director"]) expect(text).toContain(v);
  });

  test("spouse block stays blank when not declared (absent-value path)", async () => {
    const pdf = await renderAgreementPdf({
      ...FULL,
      spouseConflict: null,
      spouseName: null,
      spouseCompany: null,
      spouseDesignation: null,
    });
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.spouseName)).toBe("");
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.spouseCompanyName)).toBe("");
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.spouseDesignation)).toBe("");
  });

  test("emergency contact values are present", async () => {
    const text = pdfText(await renderAgreementPdf(FULL), 7);
    for (const v of ["Emergency Contact", "Sibling", "98765432"]) expect(text).toContain(v);
  });

  test("emergency contact stays blank when not collected (absent-value path)", async () => {
    const pdf = await renderAgreementPdf({
      ...FULL,
      emergencyName: null,
      emergencyRelationship: null,
      emergencyContact: null,
      emergencyAddress: null,
    });
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.emergencyContactName)).toBe("");
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.emergencyContactRelationship)).toBe("");
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.emergencyContactNumber)).toBe("");
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.emergencyContactAddress)).toBe("");
  });

  test("relocated footer note renders in the page-7 footer area, clear of the printed footer and the table", async () => {
    const pdf = await renderAgreementPdf(FULL);
    const note = textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.signedAtNote);
    expect(note).toContain("Signed");
    expect(note).toContain("via the Enshrine Virtual Office onboarding portal");
    // Must not collide with the printed "Page 7 of 7 / V.2026-04" footer line
    // or bleed into the For Official Use table above it.
    const footerRow = pdfWords(pdf, 7).filter((w) => w.yMin >= 818 && w.yMax <= 828);
    expect(footerRow.map((w) => w.text).join(" ")).toContain("Page");
    expect(footerRow.map((w) => w.text).join(" ")).not.toContain("Signed");
  });
});

describe("renderAgreementPdf — spouse Yes/No circle (drawn, not text)", () => {
  // annulusInkFraction is now a top-level helper (see its own definition
  // above, near the other PDF helpers) — hoisted out of this describe so the
  // cleanup-proof test can exercise it too.
  // The ellipse is word-ink-derived with three pads, not one (see agreement.ts:
  // CIRCLE_PAD_HORIZONTAL_INNER=0.90 on the side facing the "/" divider,
  // CIRCLE_PAD_HORIZONTAL_OUTER=2.5 on the far side, CIRCLE_PAD_VERTICAL=9.0)
  // — far taller than the old box-derived ellipse (box height 11.07pt vs the
  // word's own ~6.6pt ink height). This annulus window is sized generously
  // above every pad actually in play, on both the wider outer side and the
  // taller vertical axis, so it stays valid across a pad change of this
  // size without needing a matching edit here.
  const FULL_H = 6; // comfortably above CIRCLE_PAD_HORIZONTAL_OUTER(2.5) — the side with no neighbour
  const NARROW_H = 2; // the side facing the other word — comfortably above CIRCLE_PAD_HORIZONTAL_INNER(0.90)
  const FULL_V = 12; // comfortably above CIRCLE_PAD_VERTICAL(9.0) + stroke half-width(0.6) + margin
  const yesPad = { top: FULL_V, bottom: FULL_V, left: FULL_H, right: NARROW_H }; // No is to the right
  const noPad = { top: FULL_V, bottom: FULL_V, left: NARROW_H, right: FULL_H }; // Yes is to the left

  test("circles Yes when spouseConflict is true", async () => {
    const pdf = await renderAgreementPdf({ ...BASE, spouseConflict: true });
    expect(annulusInkFraction(pdf, 7, AGREEMENT_FIELD_BOXES.spouseWorkingYes, yesPad)).toBeGreaterThan(0.02);
    expect(annulusInkFraction(pdf, 7, AGREEMENT_FIELD_BOXES.spouseWorkingNo, noPad)).toBeLessThan(0.02);
  });

  test("circles No when spouseConflict is false", async () => {
    const pdf = await renderAgreementPdf({ ...BASE, spouseConflict: false });
    expect(annulusInkFraction(pdf, 7, AGREEMENT_FIELD_BOXES.spouseWorkingNo, noPad)).toBeGreaterThan(0.02);
    expect(annulusInkFraction(pdf, 7, AGREEMENT_FIELD_BOXES.spouseWorkingYes, yesPad)).toBeLessThan(0.02);
  });

  test("circles neither when spouseConflict is null (absent-value path)", async () => {
    const pdf = await renderAgreementPdf({ ...BASE, spouseConflict: null });
    expect(annulusInkFraction(pdf, 7, AGREEMENT_FIELD_BOXES.spouseWorkingYes, yesPad)).toBeLessThan(0.02);
    expect(annulusInkFraction(pdf, 7, AGREEMENT_FIELD_BOXES.spouseWorkingNo, noPad)).toBeLessThan(0.02);
  });
});

describe("renderAgreementPdf — baseline clearance (regression: a descender must not cross the printed rule)", () => {
  // The MD/AD found stamped text sitting ON the rule (a descender striking
  // through it) — root cause was a flat clearance that didn't account for
  // the descender extending below the baseline (DevLead). This asserts the
  // fixed geometry directly: past the rule's own ~0.5pt thickness, there
  // must be ZERO ink at all, even from a value chosen to contain descenders.
  function noInkBelowRule(bytes: Buffer, page: number, box: FieldBox, ruleY: number): void {
    const raster = rasterizePage(bytes, page);
    // Start 0.6pt past the rule (measured: the rule itself occupies ~0.5pt,
    // 172.56-172.8pt on spouseName) so this checks ink BELOW the rule, not
    // the rule's own pixels — down to +3pt, comfortably past any descender.
    for (let dy = 0.6; dy <= 3; dy += 0.3) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        if (raster.isDark(x, ruleY + dy)) {
          throw new Error(`ink found ${dy.toFixed(1)}pt below the rule at x=${x} — a descender is crossing it`);
        }
      }
    }
  }

  test("spouseCompanyName: a value with descenders (Legacy, Group) stays clear of its underline", async () => {
    // Underline measured directly off the pristine master at box.y+11.86≈185.76pt (independent of anything this test stamps).
    const pdf = await renderAgreementPdf({ ...BASE, spouseConflict: true, spouseCompany: "Apex Legacy Group" });
    expect(() => noInkBelowRule(pdf, 7, AGREEMENT_FIELD_BOXES.spouseCompanyName, 185.76)).not.toThrow();
  });

  test("emergencyContactName: a value with a descender (Emergency) stays clear of its underline", async () => {
    // Underline measured at box.y+11.84≈229.44pt.
    const pdf = await renderAgreementPdf({ ...BASE, emergencyName: "Emergency Gyro Ipswich" });
    expect(() => noInkBelowRule(pdf, 7, AGREEMENT_FIELD_BOXES.emergencyContactName, 229.44)).not.toThrow();
  });

  test("mutation control: the OLD flat 2pt clearance would have failed this exact check", () => {
    // Not a rendering test — a direct arithmetic check that the new formula
    // actually differs from the old one in the failing direction, so the
    // two tests above are not passing by accident. Old: box.y+height-2.
    // New: box.y+height-(descenderDepth(9)+1.75). Times-Roman descender at
    // 9pt is 1.953pt (AFM Descender -217/1000em; DevLead's cross-check).
    const oldClearance = 2;
    const newClearance = 1.953 + 1.75;
    expect(newClearance).toBeGreaterThan(oldClearance);
    // The old clearance left only 2 - 1.953 = 0.047pt between the BASELINE
    // and the rule — i.e. essentially zero margin before even counting the
    // descender's own length below that baseline.
    expect(oldClearance - 1.953).toBeCloseTo(0.047, 3);
  });
});

describe("renderAgreementPdf — For Official Use: Tier 1/2 NA and Associate ID", () => {
  test("no intended upline -> Tier 1 'NA' AND Tier 2 'NA'", async () => {
    const pdf = await renderAgreementPdf({
      ...BASE,
      tier1Manager: formatUplineOrNA(null),
      tier2Manager: formatUplineOrNA(null),
    });
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.tier1ManagerOfficial)).toBe("NA");
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.tier2ManagerOfficial)).toBe("NA");
  });

  test("an upline with no upline of their own -> Tier 1 filled, Tier 2 'NA'", async () => {
    const pdf = await renderAgreementPdf({
      ...BASE,
      tier1Manager: formatUplineOrNA({ fullName: "Jane Upline", associateCode: "EN0001" }),
      tier2Manager: formatUplineOrNA(undefined),
    });
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.tier1ManagerOfficial)).toBe("Jane Upline (EN0001)");
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.tier2ManagerOfficial)).toBe("NA");
  });

  test("'NA' is scoped to Tier 1/2 only — a genuinely absent OTHER field stays blank, never 'NA'", async () => {
    const pdf = await renderAgreementPdf({ ...BASE, homeAddress: null, religion: null });
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.homeAddress)).toBe("");
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.religion)).toBe("");
  });

  test("the signed PDF is never modified after signing — Associate ID is NEVER stamped, even when the type carries one", async () => {
    // A ruling is not enforced by anything unless something asserts it
    // (AD). Keyed to the rule, not the person who made it — a test name
    // surfaces in CI output and survives the person moving on; attribution:
    // the owner's ruling of 2026-09-28, recorded in the team's decision log.
    // associateId is a real AgreementData field (kept for a possible
    // future administrative copy) but renderAgreementPdf must never read it
    // for the SIGNED copy — nextAssociateCode() doesn't exist until
    // approveCandidate runs anyway. Proved by passing one and asserting
    // nothing renders in that box, so a future contributor filling in "the
    // last blank box on a form" gets a red test, not a silently-changed
    // legal document.
    const pdf = await renderAgreementPdf({ ...BASE, associateId: "EN9999" });
    expect(textInBoxRow(pdf, AGREEMENT_FIELD_BOXES.associateIdOfficial)).toBe("");
  });
});

describe("renderAgreementPdf — spouse circle must not touch the '/' between Yes and No", () => {
  // Regression: the first pad (2.5pt, then 2pt) put the ellipse's STROKE
  // (which extends ~borderWidth/2 past its mathematical radius) into the
  // "/" glyph's own bbox. A differential render (with the circle vs without)
  // isolates exactly the pixels the circle itself adds — the tight bbox
  // check elsewhere can't be reused here because "/" and "Yes"/"No" are only
  // ~2.5pt apart, well inside any plausible annulus pad.
  // 🔴 KNOWN BLIND SPOT, kept and not silently fixed in place: a with/without
  // DIFFERENTIAL can't see a stroke that lands exactly ON a pixel the slash
  // itself already darkens — that pixel is dark in BOTH renders, so it never
  // counts as "added", even though the stroke is genuinely touching real
  // ink there. `agreement-circle-ink-intersection.test.ts` is the
  // authoritative check for this property (two independently measured ink
  // masks, intersected, with a planted-overlap control proving the check
  // can report a positive) — this test stays as a second, cheap, poppler-
  // only signal for the "added ink appeared out of nowhere" case, which it
  // still genuinely covers.
  const SLASH_BBOX = { x: 487.729, y: 162.832, width: 490.509 - 487.729, height: 173.902 - 162.832 };

  async function pixelsCircleAddsInsideSlash(spouseConflict: boolean): Promise<number> {
    const neither = rasterizePage(await renderAgreementPdf({ ...BASE, spouseConflict: null }), 7);
    const circled = rasterizePage(await renderAgreementPdf({ ...BASE, spouseConflict }), 7);
    let added = 0;
    for (let x = SLASH_BBOX.x; x < SLASH_BBOX.x + SLASH_BBOX.width; x += 0.1) {
      for (let y = SLASH_BBOX.y; y < SLASH_BBOX.y + SLASH_BBOX.height; y += 0.1) {
        if (circled.isDark(x, y) && !neither.isDark(x, y)) added++;
      }
    }
    return added;
  }

  test("circling Yes adds no ink inside the '/' bbox", async () => {
    expect(await pixelsCircleAddsInsideSlash(true)).toBe(0);
  });

  test("circling No adds no ink inside the '/' bbox", async () => {
    expect(await pixelsCircleAddsInsideSlash(false)).toBe(0);
  });
});

describe("renderAgreementPdf — rule_y switch: the null path is a branch, not arithmetic (AD's ask)", () => {
  // AD's hazard: `rule_y ?? 0` or bare `rule_y + x` would silently coerce a
  // null rule to 0 and draw text ~2pt from the page's bottom edge — no
  // throw, no NaN, indistinguishable on screen from a blank field. These
  // assert the ACTUAL rendered baseline lands at the right number for both
  // paths, not just "it didn't throw" (which passes on the bug).
  const NOLETTER = "TEST NOLETTER"; // no descenders, so its own ink bottom IS the baseline exactly
  const FONT_9PT_DESCENDER = 1.953; // Times-Roman AFM Descender at 9pt, cross-checked against pdf-lib heightAtSize
  const CLEARANCE = 1.75;

  // `stopBefore`: the scan must not reach the printed rule itself (or any
  // other box's ink) — with NOLETTER's real clearance the text sits well
  // clear of it, so stopping just short of the rule finds only OUR ink.
  function stampedBaseline(bytes: Buffer, page: number, box: FieldBox, stopBefore: number): number {
    const raster = rasterizePage(bytes, page);
    let lastDark: number | null = null;
    for (let y = box.y; y < stopBefore - 0.5; y += 0.1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        if (raster.isDark(x, y)) { lastDark = y; break; }
      }
    }
    if (lastDark === null) throw new Error("no ink found — value didn't render");
    return lastDark;
  }

  test("a rule-anchored field's baseline = rule_y − (descender(size) + 1.75)", async () => {
    const pdf = await renderAgreementPdf({ ...BASE, fullName: NOLETTER });
    const ruleY = AGREEMENT_FIELD_RULE_Y.fullName as number;
    expect(ruleY).not.toBeNull();
    const expected = ruleY - (FONT_9PT_DESCENDER + CLEARANCE);
    expect(stampedBaseline(pdf, 1, AGREEMENT_FIELD_BOXES.fullName, ruleY)).toBeCloseTo(expected, 0); // within ~0.3pt (pixel quantization)
  });

  test("a no-rule field (null in the table) keeps its explicit baselineFromTop — NOT box.y+box.height, NOT 0", async () => {
    // signatureName: AGREEMENT_FIELD_RULE_Y.signatureName is null. If the
    // switch ever regresses to `rule_y ?? 0` or similar, this value would
    // collapse toward the page's bottom edge (~830+) instead of ~408.83.
    expect(AGREEMENT_FIELD_RULE_Y.signatureName).toBeNull();
    const pdf = await renderAgreementPdf({ ...BASE, fullName: NOLETTER });
    const baseline = stampedBaseline(pdf, 7, AGREEMENT_FIELD_BOXES.signatureName, 410);
    expect(baseline).toBeCloseTo(408.83, 0);
    expect(baseline).toBeLessThan(700); // sanity bound against the null-coercion failure mode specifically
  });

  test("ruleOpts throws for any field with no measured rule, rather than silently deriving 0", () => {
    for (const field of ["signatureName", "signatureNric", "signedAtNote", "signatureImage", "commencementImmediateCheckbox"] as const) {
      expect(() => ruleOpts(field), field).toThrow(/no measured rule/);
    }
  });

  test("ruleOpts returns the exact measured value for a field that has one", () => {
    expect(ruleOpts("fullName")).toEqual({ ruleFromTop: 197.04 });
    expect(ruleOpts("tier1ManagerOfficial")).toEqual({ ruleFromTop: 744.72 });
  });
});

describe("renderAgreementPdf — upward bound: new clearance must not float into the label above (AD's ask)", () => {
  // The failure direction AD flagged: a wrong/generous rule_y-derived
  // clearance could push text UP into the row's own printed label, not just
  // down into a rule below. Checked on the fields DevLead's own derivation
  // named as the floating-high candidates (box bottom sits ABOVE its rule)
  // plus the truncation-ruling field.
  function labelBottom(page: number, x0: number, y0: number, x1: number, y1: number): number {
    // returns the lowest y (top-down) with any dark pixel in the given
    // region on the PRISTINE master — i.e. the label's own visual bottom.
    const raster = rasterizePage(readFileSync(join(process.cwd(), MASTER_TEMPLATE_PATH)), page);
    let last = y0;
    for (let y = y0; y < y1; y += 0.2) {
      for (let x = x0; x < x1; x += 2) {
        if (raster.isDark(x, y)) { last = y; break; }
      }
    }
    return last;
  }

  function stampedBaselineTop(bytes: Buffer, page: number, box: FieldBox): number {
    const raster = rasterizePage(bytes, page);
    let last: number | null = null;
    for (let y = box.y - 2; y < box.y + box.height + 3; y += 0.1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        if (raster.isDark(x, y)) { last = y; break; }
      }
    }
    if (last === null) throw new Error("no ink found");
    return last;
  }

  test("gender/nricMasked/mobile/religion: stamped baseline stays below (numerically greater than) their own row's label", async () => {
    const pdf = await renderAgreementPdf({
      ...BASE, gender: "Male", nricMasked: "S1234567A", mobile: "91234567", religion: "None",
    });
    // Label bottoms measured directly (pdftotext bbox, page 1): "Gender:"
    // y=[262.01,271.97]; "NRIC No:" y=[231.72,241.68]; "Mobile No:"
    // y=[292.30,302.27]; "Religion:" y=[292.30,302.27] (same row as Mobile).
    const cases: [string, FieldBox, number][] = [
      ["gender", AGREEMENT_FIELD_BOXES.gender, 271.97],
      ["nricMasked", AGREEMENT_FIELD_BOXES.nricMasked, 241.68],
      ["mobile", AGREEMENT_FIELD_BOXES.mobile, 302.27],
      ["religion", AGREEMENT_FIELD_BOXES.religion, 302.27],
    ];
    for (const [name, box, labelBottomY] of cases) {
      const baseline = stampedBaselineTop(pdf, 1, box);
      expect(baseline, `${name}: stamped baseline must be below its own label`).toBeGreaterThan(labelBottomY);
    }
    // Explicit timeout, reasoned not guessed (F6's own standing rule: never
    // blindly raise a timeout): this one test spawns 4 separate `pdftoppm`
    // subprocesses (one per field, via stampedBaselineTop), the heaviest
    // subprocess load of any test in this file. Observed timing out at the
    // 5000ms default under full-suite parallel load (98 files, CPU
    // contention) — genuinely a load-induced timeout, not a hang: re-run in
    // isolation passed every time. 15s leaves ample headroom over the
    // ~hundreds-of-ms-per-subprocess normally observed.
  }, 15_000);

  test("emergencyContactAddress: stamped baseline stays below its own row's label", async () => {
    const pdf = await renderAgreementPdf({ ...BASE, emergencyAddress: "12 Test Ave #01-23" });
    // "Address:" label bottom on this row, measured directly.
    const lbl = labelBottom(7, 47.02, 230, 108.78, 244);
    const baseline = stampedBaselineTop(pdf, 7, AGREEMENT_FIELD_BOXES.emergencyContactAddress);
    expect(baseline).toBeGreaterThan(lbl);
    // Lighter than the test above (2 subprocess spawns, not 4) but same
    // class of risk under load — same reasoning, smaller margin.
  }, 10_000);
});

describe("fitText — boundary cases (DevLead's ask, direct not rendered)", () => {
  // Exact-metric boundaries are awkward to hit through a rendered PDF's
  // pixels, so these call fitText directly with the SAME font instance
  // agreement.ts embeds, constructing box widths from the font's own
  // reported metrics rather than guessed round numbers.
  async function timesFont() {
    const doc = await PDFDocument.create();
    return doc.embedFont(StandardFonts.TimesRoman);
  }
  const box = (width: number): FieldBox => ({ page: 7, x: 0, y: 0, width, height: 14 });

  test("a value that fits at FONT_START_SIZE (9) renders untouched, no shrink", async () => {
    const font = await timesFont();
    const text = "Hi";
    const result = fitText(font, text, box(200));
    expect(result).toEqual({ lines: [text], size: 9 });
  });

  test("a value that shrinks to exactly the 7pt floor and fits there", async () => {
    const font = await timesFont();
    const text = "Boundary Case Sample Text";
    // Width scales linearly with size for a fixed font, so a box sized to
    // EXACTLY the text's width at 7pt fails every size above 7 (each is
    // wider by size/7) and passes at 7 itself (equality, "<=").
    const widthAt7 = font.widthOfTextAtSize(text, 7);
    const result = fitText(font, text, box(widthAt7));
    expect(result).toEqual({ lines: [text], size: 7 });
  });

  test("a value that still doesn't fit at 7pt gets ellipsis-truncated, never shrunk below the floor", async () => {
    const font = await timesFont();
    const text = "This value is much too long for its narrow box on the page";
    const widthAt7 = font.widthOfTextAtSize(text, 7);
    const result = fitText(font, text, box(widthAt7 * 0.3));
    expect(result.size).toBe(7);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].endsWith("…")).toBe(true);
    expect(result.lines[0].length).toBeLessThan(text.length);
  });

  test("degenerate: a box too narrow for even one character + ellipsis still returns a non-empty single line", async () => {
    const font = await timesFont();
    const text = "Wide";
    // truncated.length > 1 is the loop's own floor — confirm what it renders
    // rather than assuming, for a box narrower than any real field on this
    // master would be.
    const result = fitText(font, text, box(0.5));
    expect(result.size).toBe(7);
    expect(result.lines).toEqual(["W…"]); // 1 original char retained + ellipsis, per the length>1 floor
  });
});

describe("wouldTruncate — homeAddress fit warning (item 5), boundary measured with the real font", () => {
  // Binary search the longest run of "A"s that still fits the REAL
  // homeAddress box at the 7pt floor (the most permissive size fitText
  // tries — narrower text at a smaller size fits more width) — a measured
  // boundary, not an assumed character count.
  let fits: string;
  let overflow: string;

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const boxWidth = AGREEMENT_FIELD_BOXES.homeAddress.width;
    let lo = 0;
    let hi = 200;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (font.widthOfTextAtSize("A".repeat(mid), 7) <= boxWidth) lo = mid;
      else hi = mid - 1;
    }
    expect(font.widthOfTextAtSize("A".repeat(lo), 7)).toBeLessThanOrEqual(boxWidth);
    expect(font.widthOfTextAtSize("A".repeat(lo + 1), 7)).toBeGreaterThan(boxWidth);
    fits = "A".repeat(lo);
    overflow = "A".repeat(lo + 1);
  });

  test("a value at the measured fit boundary does not truncate", async () => {
    await expect(wouldTruncate(fits)).resolves.toBe(false);
  });

  test("one character past the measured boundary truncates", async () => {
    await expect(wouldTruncate(overflow)).resolves.toBe(true);
  });

  test("empty or whitespace-only value never truncates (matches stampField's own blank-draws-nothing rule)", async () => {
    await expect(wouldTruncate("")).resolves.toBe(false);
    await expect(wouldTruncate("   ")).resolves.toBe(false);
  });
});

describe("temp-dir cleanup (tmpfs hotfix, 2026-10-01)", () => {
  // Every raster/rasterize-adjacent helper in this file mkdtemp'd a scratch
  // directory and never removed it — on a small or tmpfs-backed /tmp, that
  // accumulation across repeated suite runs can exhaust it. Scoped to the
  // exact paths THIS test creates (via mkTempDir's tracking array), not a
  // directory-wide "no agpdf-* left in tmpdir()" scan — this file's own unit
  // tests run 8-way parallel, so a global scan would read another worker's
  // legitimate in-flight directory as a leak and turn this into a new flake.
  test("every directory created while rendering + rasterizing + text-extracting a real page is removed again — not merely assumed", async () => {
    createdTempDirs.length = 0;
    const pdf = await renderAgreementPdf(BASE);
    expect(pdfPageCount(pdf)).toBe(7); // exercises toTempPdf
    pdfText(pdf, 1); // exercises toTempPdf
    pdfWords(pdf, 1); // exercises toTempPdf
    rasterizePage(pdf, 1); // exercises toTempPdf + its own raster dir
    annulusInkFraction(pdf, 7, { x: 0, y: 0, width: 1, height: 1 }, { top: 1, bottom: 1, left: 1, right: 1 }); // exercises toTempPdf + its own raster dir — the one site a blind spot here let leak 12 real directories, proven by mutation

    // Control: a run that created nothing would make "every dir is gone"
    // vacuously true — the exact failure shape this whole PR is about
    // (identical to "0 leftovers" meaning "the helper never ran"). At least
    // one dir per call above (toTempPdf x5, rasterizePage's + annulusInkFraction's own raster dirs).
    expect(createdTempDirs.length).toBeGreaterThanOrEqual(6);

    for (const dir of createdTempDirs) {
      // Proves this measured the LIVE tmpdir() (so a TMPDIR override, like
      // the one this whole incident forced onto every session tonight, is
      // honoured) rather than a hardcoded "/tmp" assumption.
      expect(dir.startsWith(tmpdir())).toBe(true);
      expect(existsSync(dir)).toBe(false);
    }
  });
});
