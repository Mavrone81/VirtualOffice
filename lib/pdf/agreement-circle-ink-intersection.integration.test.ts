import { describe, test, expect } from "vitest";
import { execFileSync } from "child_process";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "fs";
import { readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Tmpfs hotfix (2026-10-01): same convention as lib/pdf/agreement.integration.test.ts's
// own mkTempDir — this directory was never removed, one of several leak
// classes found; on a small or tmpfs-backed /tmp, that accumulation across
// repeated suite runs can exhaust it. Tracked so the cleanup-proof test
// below can assert against the exact paths created, never a directory-wide
// tmpdir() scan (unsafe under this file's own parallel unit-test workers).
const createdTempDirs: string[] = [];
import { PDFDocument, rgb } from "pdf-lib";
import { renderAgreementPdf, CIRCLE_PAD_HORIZONTAL_INNER, CIRCLE_PAD_HORIZONTAL_OUTER, CIRCLE_PAD_VERTICAL, type AgreementData } from "@/lib/pdf/agreement";
import { PAGE_SIZE, AGREEMENT_CIRCLE_WORD_INK, MASTER_TEMPLATE_PATH } from "@/lib/pdf/associate-agreement-coordinates";

// ---------------------------------------------------------------------------
// The AUTHORITATIVE check for "does the spouse Yes/No circle touch anything
// it shouldn't" (2026-09-30). Exists because a with/without DIFFERENTIAL
// (agreement.integration.test.ts's own older check, kept alongside this one) is blind by
// construction to a stroke landing exactly on a pixel the target glyph
// ALREADY darkens: that pixel reads dark in both the "circled" and the
// "neither" render, so a diff never counts it as "added", even though the
// stroke is genuinely touching real ink there.
//
// 🔴 REQUIRES ghostscript (`gs`) on PATH — poppler is DISQUALIFIED for this
// specific stroke geometry: it has previously under-rendered this exact
// ellipse and reported a false clean pass at a setting later found visibly
// touching. This file never uses pdftoppm/pdftotext for a clearance figure.
//
// Method: two ink masks, measured INDEPENDENTLY, then intersected —
//   (a) the ellipse's OWN mask, from a render containing ONLY the ellipse
//       on an otherwise blank page (zero ambiguity with the master's own
//       printed ink),
//   (b) the master's own ink (words, the "/" divider, everything printed),
//       from the pristine, unstamped master.
// A shared dark pixel between the two is a genuine touch — not inferred
// from what changed, but from where two independently-drawn things both put
// ink. A planted-overlap control (deliberately oversized pad) proves this
// method can report a positive at all, per the standing rule that an
// overlap check which can't fire can't be trusted to report an absence.
//
// Resolution: 600dpi minimum, stated beside every figure. 300dpi is
// rejected outright on this exact page — recorded evidence (a prior
// CIRCLE_PAD measurement) found it a quantisation artefact, not a second
// real measurement, at pad values where 600dpi read UNDER the 1pt floor.
// ---------------------------------------------------------------------------

const DPI = 600;
if (DPI < 600) throw new Error("this file's own resolution floor — must never be lowered without re-deriving every figure it asserts");

function gsRasterize(bytes: Buffer, page: number, dpi: number) {
  const dir = mkdtempSync(join(tmpdir(), "circle-ink-gs-"));
  createdTempDirs.push(dir);
  try {
    const pdfPath = join(dir, "in.pdf");
    const pngPath = join(dir, "out.png");
    writeFileSync(pdfPath, bytes);
    execFileSync("gs", [
      "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER",
      "-sDEVICE=png16m", `-r${dpi}`,
      `-dFirstPage=${page}`, `-dLastPage=${page}`,
      `-o${pngPath}`, pdfPath,
    ]);
    // decodePng reads the PNG fully into an in-memory Buffer before
    // returning — the returned isDark closure never touches disk again, so
    // it's safe to remove the directory here rather than leak it.
    return decodePng(readFileSync(pngPath), dpi);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Minimal PNG decoder for Ghostscript's png16m output (8-bit RGB,
 *  non-interlaced) — no image-library dependency in the shipped suite.
 *  Handles all 5 PNG filter types per spec. */
function decodePng(buf: Buffer, dpi: number) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- zlib inflate, no static import needed elsewhere in this file
  const zlib = require("zlib") as typeof import("zlib");
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG (bad signature)");
  let idx = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks: Buffer[] = [];
  while (idx < buf.length) {
    const len = buf.readUInt32BE(idx);
    const type = buf.toString("ascii", idx + 4, idx + 8);
    const dataStart = idx + 8;
    if (type === "IHDR") {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === "IDAT") {
      idatChunks.push(buf.subarray(dataStart, dataStart + len));
    } else if (type === "IEND") {
      break;
    }
    idx = dataStart + len + 4;
  }
  if (bitDepth !== 8) throw new Error(`unexpected PNG bit depth ${bitDepth}`);
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : -1;
  if (channels < 1) throw new Error(`unexpected PNG color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let rawIdx = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawIdx++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const rawX = raw[rawIdx + x];
      const a = x >= channels ? pixels[rowStart + x - channels] : 0;
      const b = y > 0 ? pixels[rowStart - stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[rowStart - stride + x - channels] : 0;
      let value: number;
      switch (filterType) {
        case 0: value = rawX; break;
        case 1: value = (rawX + a) & 0xff; break;
        case 2: value = (rawX + b) & 0xff; break;
        case 3: value = (rawX + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = (rawX + pr) & 0xff;
          break;
        }
        default: throw new Error(`unexpected PNG filter type ${filterType}`);
      }
      pixels[rowStart + x] = value;
    }
    rawIdx += stride;
  }
  const scale = dpi / 72;
  return {
    width, height, scale,
    /** Strictest ink threshold — any channel below 250, not "majority
     *  covered" — per the acceptance floor this file enforces. */
    isDark(xPt: number, yPt: number): boolean {
      const x = Math.round(xPt * scale), y = Math.round(yPt * scale);
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const off = (y * width + x) * channels;
      return pixels[off] < 250 || pixels[off + 1] < 250 || pixels[off + 2] < 250;
    },
  };
}

type InkBBox = { minX: number; minY: number; maxX: number; maxY: number };
const SLASH_INK: InkBBox = { minX: 487.64, minY: 164.8, maxX: 490.28, maxY: 171.76 }; // measured off the pristine master, same method as AGREEMENT_CIRCLE_WORD_INK

/** Render ONLY the ellipse (no master background) on a blank page the same
 *  size as the real document — the ellipse's own ink mask, unambiguous.
 *  `leftPad`/`rightPad` mirror stampCircle's own asymmetric construction
 *  exactly (an ellipse centred OFF the word's own geometric centre, not a
 *  symmetric one) — pass them in the same order agreement.ts derives them
 *  from `dividerSide`, never a single shared pad. */
async function ellipseOnlyRaster(ink: InkBBox, leftPad: number, rightPad: number, padV: number, dpi: number) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_SIZE.width, PAGE_SIZE.height]);
  const x0 = ink.minX - leftPad, x1 = ink.maxX + rightPad;
  const cx = (x0 + x1) / 2, cy = (ink.minY + ink.maxY) / 2;
  const halfH = (ink.maxY - ink.minY) / 2;
  page.drawEllipse({
    x: cx, y: PAGE_SIZE.height - cy,
    xScale: (x1 - x0) / 2, yScale: halfH + padV,
    borderColor: rgb(0.1, 0.12, 0.17), borderWidth: 1.2,
  });
  return gsRasterize(Buffer.from(await pdfDoc.save()), 1, dpi);
}

// Which side of each word's own ink the "/" divider sits on — Yes: right,
// No: left (agreement.ts's stampCircle call sites) — so leftPad/rightPad
// per word is {OUTER, INNER} or {INNER, OUTER} accordingly.
const DIVIDER_SIDE = { spouseWorkingYes: "right", spouseWorkingNo: "left" } as const;
function padsFor(key: keyof typeof DIVIDER_SIDE): { leftPad: number; rightPad: number } {
  return DIVIDER_SIDE[key] === "right"
    ? { leftPad: CIRCLE_PAD_HORIZONTAL_OUTER, rightPad: CIRCLE_PAD_HORIZONTAL_INNER }
    : { leftPad: CIRCLE_PAD_HORIZONTAL_INNER, rightPad: CIRCLE_PAD_HORIZONTAL_OUTER };
}

function scanIntersection(
  maskA: ReturnType<typeof gsRasterize>,
  maskB: ReturnType<typeof gsRasterize>,
  win: { x0: number; y0: number; x1: number; y1: number },
  stepPt: number,
): { overlapCount: number; firstOverlap: { x: number; y: number } | null } {
  let overlapCount = 0;
  let firstOverlap: { x: number; y: number } | null = null;
  for (let x = win.x0; x <= win.x1; x += stepPt) {
    for (let y = win.y0; y <= win.y1; y += stepPt) {
      if (maskA.isDark(x, y) && maskB.isDark(x, y)) {
        overlapCount++;
        if (!firstOverlap) firstOverlap = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
      }
    }
  }
  return { overlapCount, firstOverlap };
}

const BASE: AgreementData = {
  fullName: "Test Associate", designation: "Sales Associate", email: "test@example.com",
  mobile: "91234567", nricMasked: "S****123A", signedDate: new Date("2026-09-30T10:00:00+08:00"),
};

describe("spouse Yes/No circle — ink-mask intersection against the '/' divider (Ghostscript, 600dpi)", () => {
  test("PRE-REGISTRATION: the shipped pads are the exact values this file's figures were measured against", () => {
    // Every figure in the tests below (and in the reported evidence for
    // this change) was measured at THESE pad values. If either constant
    // ever changes, this fails immediately — a signal to re-derive every
    // figure in this file, not carry the old ones forward as a quotation.
    expect(CIRCLE_PAD_HORIZONTAL_INNER).toBe(0.90);
    expect(CIRCLE_PAD_HORIZONTAL_OUTER).toBe(2.5);
    expect(CIRCLE_PAD_VERTICAL).toBe(9.0);
    expect(DPI).toBeGreaterThanOrEqual(600);
  });

  // 🔴 FIDELITY, not a differential: comparing the REAL rendered page
  // straight against the pristine master for "overlap" is a trap — the "/"
  // itself is STATIC content present in BOTH (renderAgreementPdf never
  // removes it), so every one of its own pixels would trivially "overlap"
  // regardless of whether the ellipse touches anything at all (confirmed:
  // an early version of this file did exactly that and reported 186 false
  // "overlap" pixels that were just the slash agreeing with itself). The
  // isolated ellipse-only mask (rendered on a blank page, from the SAME
  // exported constants renderAgreementPdf uses) avoids that entirely — but
  // then it must be PROVEN faithful to the real render, not assumed:
  // "fidelityHolds" checks every ink pixel the isolated mask reports is
  // ALSO ink in the real, full renderAgreementPdf() output at that exact
  // coordinate. Only once fidelity holds does "the isolated mask doesn't
  // touch the slash" transfer to "the real render doesn't touch the slash".
  function fidelityHolds(
    isolated: ReturnType<typeof gsRasterize>,
    real: ReturnType<typeof gsRasterize>,
    win: { x0: number; y0: number; x1: number; y1: number },
    stepPt: number,
  ): boolean {
    for (let x = win.x0; x <= win.x1; x += stepPt) {
      for (let y = win.y0; y <= win.y1; y += stepPt) {
        if (isolated.isDark(x, y) && !real.isDark(x, y)) return false;
      }
    }
    return true;
  }

  test("real render: the isolated-ellipse reconstruction is faithful, and neither Yes nor No overlaps the '/' divider's own ink", async () => {
    const master = gsRasterize(readFileSync(join(process.cwd(), MASTER_TEMPLATE_PATH)), 7, DPI);
    const stepPt = 1 / (DPI / 72);
    const slashWin = { x0: SLASH_INK.minX - 0.5, y0: SLASH_INK.minY - 0.5, x1: SLASH_INK.maxX + 0.5, y1: SLASH_INK.maxY + 0.5 };
    for (const spouseConflict of [true, false]) {
      const key = spouseConflict ? "spouseWorkingYes" : "spouseWorkingNo";
      const real = gsRasterize(await renderAgreementPdf({ ...BASE, spouseConflict }), 7, DPI);
      const { leftPad, rightPad } = padsFor(key);
      const isolated = await ellipseOnlyRaster(AGREEMENT_CIRCLE_WORD_INK[key], leftPad, rightPad, CIRCLE_PAD_VERTICAL, DPI);
      const ink = AGREEMENT_CIRCLE_WORD_INK[key];
      const ellipseWin = { x0: ink.minX - leftPad - 2, y0: ink.minY - CIRCLE_PAD_VERTICAL - 2, x1: ink.maxX + rightPad + 2, y1: ink.maxY + CIRCLE_PAD_VERTICAL + 2 };
      expect({ key, fidelity: fidelityHolds(isolated, real, ellipseWin, stepPt) }).toEqual({ key, fidelity: true });

      const { overlapCount, firstOverlap } = scanIntersection(isolated, master, slashWin, stepPt);
      expect({ key, overlapCount, firstOverlap }).toEqual({ key, overlapCount: 0, firstOverlap: null });
    }
  }, 120_000); // Sized up from vitest's 30s default (review, 2026-09-30): 2 real renders + 2
  // isolated renders + fidelity scan, each a 600dpi full-page Ghostscript raster walked per pixel —
  // measured 28.07s isolated/idle (a 1.93s, 6.4% margin under the old 30s default) and it actually
  // TIMES OUT under full-suite parallel load on this box. 120s is sized for that load.
  // 🔴 The other two tests below need the SAME load-aware budget, not a tighter one of their own —
  // DevLead measured "enclosure" (a lighter single raster + scan) at 7,480ms idle but 27,042ms at
  // load 4.42, well past a 20s budget, and CI runners (2-4 cores) are the TIGHTER case, not the
  // looser one. A per-test "this one is heavy, the rest are fine" split doesn't survive load.

  test("PLANTED-OVERLAP CONTROL: an oversized INNER (divider-facing) pad DOES report a real overlap — the check can fire", async () => {
    // Not a production value — deliberately far past the slash, proving the
    // detector reports a positive rather than always returning clear. Only
    // the divider-facing side is oversized; the outer side stays real,
    // since that's the side this control is about.
    const oversizedInner = 4.0;
    const master = gsRasterize(readFileSync(join(process.cwd(), MASTER_TEMPLATE_PATH)), 7, DPI);
    const win = { x0: SLASH_INK.minX - 0.5, y0: SLASH_INK.minY - 0.5, x1: SLASH_INK.maxX + 0.5, y1: SLASH_INK.maxY + 0.5 };
    const stepPt = 1 / (DPI / 72);
    for (const key of ["spouseWorkingYes", "spouseWorkingNo"] as const) {
      const side = DIVIDER_SIDE[key];
      const leftPad = side === "left" ? oversizedInner : CIRCLE_PAD_HORIZONTAL_OUTER;
      const rightPad = side === "right" ? oversizedInner : CIRCLE_PAD_HORIZONTAL_OUTER;
      const badRaster = await ellipseOnlyRaster(AGREEMENT_CIRCLE_WORD_INK[key], leftPad, rightPad, CIRCLE_PAD_VERTICAL, DPI);
      const { overlapCount } = scanIntersection(badRaster, master, win, stepPt);
      expect(overlapCount).toBeGreaterThan(0);
    }
  }, 120_000); // Same load-aware budget as the test above — one real raster + one isolated raster +
  // a scan, the same shape of work that timed out at 20s under load.

  test("enclosure: the ellipse's own stroke does not touch either word's own printed ink (both axes)", async () => {
    const master = gsRasterize(readFileSync(join(process.cwd(), MASTER_TEMPLATE_PATH)), 7, DPI);
    const stepPt = 1 / (DPI / 72);
    for (const key of ["spouseWorkingYes", "spouseWorkingNo"] as const) {
      const ink = AGREEMENT_CIRCLE_WORD_INK[key];
      const { leftPad, rightPad } = padsFor(key);
      const ellipseRaster = await ellipseOnlyRaster(ink, leftPad, rightPad, CIRCLE_PAD_VERTICAL, DPI);
      const wordWin = { x0: ink.minX - 1, y0: ink.minY - 1, x1: ink.maxX + 1, y1: ink.maxY + 1 };
      const { overlapCount, firstOverlap } = scanIntersection(ellipseRaster, master, wordWin, stepPt);
      expect({ key, overlapCount, firstOverlap }).toEqual({ key, overlapCount: 0, firstOverlap: null });
    }
  }, 120_000); // The test DevLead measured directly: 7,480ms idle, 27,042ms at load 4.42 — well past
  // the old 20s budget, and CI's 2-4 cores make that the TIGHTER case, not the looser one.
});

describe("temp-dir cleanup (tmpfs hotfix, 2026-10-01)", () => {
  // circle-ink-gs-* was never removed, one of several leak classes found
  // tonight. Scoped to this test's own tracked paths, not a directory-wide
  // tmpdir() scan, for the same
  // parallel-worker reason as lib/pdf/agreement.integration.test.ts's own proof test —
  // a SEPARATE test from the three above, so it adds nothing to their own
  // (already load-sensitive) elapsed time.
  test("every directory gsRasterize creates is removed again — not merely assumed", async () => {
    createdTempDirs.length = 0;
    gsRasterize(readFileSync(join(process.cwd(), MASTER_TEMPLATE_PATH)), 7, DPI);
    await ellipseOnlyRaster(AGREEMENT_CIRCLE_WORD_INK.spouseWorkingYes, CIRCLE_PAD_HORIZONTAL_INNER, CIRCLE_PAD_HORIZONTAL_OUTER, CIRCLE_PAD_VERTICAL, DPI);

    // Control: a run that created nothing would make "every dir is gone"
    // vacuously true.
    expect(createdTempDirs.length).toBeGreaterThanOrEqual(2);

    for (const dir of createdTempDirs) {
      expect(dir.startsWith(tmpdir())).toBe(true); // measured the LIVE tmpdir(), not a hardcoded "/tmp"
      expect(existsSync(dir)).toBe(false);
    }
  }, 120_000); // Same load-aware budget as its siblings above — measured margins across four
  // load passes put this test at 2.41x against 30s, the tightest in the file, and a 2.1x spike
  // seen on "enclosure" in this same file would put it at ~1.15x: the exact range that produced
  // the original 27,042ms failure. No cost to a high ceiling on a test that normally runs 8-12s.
});
