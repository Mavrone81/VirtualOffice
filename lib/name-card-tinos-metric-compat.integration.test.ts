// Tinos font fallback kit. The defect this guards: the name-card's Times New
// Roman text (components/name-card/studio.tsx) used `'Times New Roman',
// Georgia, serif` with no self-hosted face. Android ships neither Times New
// Roman nor Liberation Serif (its serif is Noto Serif, a different
// typeface) -- there is no Android device in this box's test fleet, so the
// defect can't be reproduced directly (same shape as C-1's fonts.check()
// problem: "can't test the platform" is converted below into "can test the
// property" instead).
//
// The property: self-hosting Tinos FIRST in the stack should make the
// rendered metrics independent of whatever serif fonts the underlying OS
// happens to provide. That's testable on ANY machine, including this one,
// by comparing a probe using the real stack against the same probe with
// every OS-DEPENDENT entry swapped for a guaranteed-nonexistent name while
// the self-hosted entry stays -- if Tinos alone is really controlling the
// render, the two must measure identically, on this box exactly as much as
// on a phone that has nothing else in the stack.
//
// Same live-server + real-Chromium infrastructure as
// lib/middleware-fonts-live.integration.test.ts (CHROMIUM_INSTALLED probe,
// derived port, process-group kill) -- not reproduced in comments here;
// see that file for why each piece exists.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const CHROMIUM_INSTALLED = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
if (!CHROMIUM_INSTALLED && process.env.CI) {
  throw new Error(
    "lib/name-card-tinos-metric-compat.integration.test.ts: Chromium is not installed, and CI is set. " +
      "The workflow's 'Install Chromium' step should have run before this file -- failing loudly " +
      "instead of skipping, since a skip here would hide that step actually failing.",
  );
}
if (!CHROMIUM_INSTALLED) {
  console.warn(
    "\n⚠ SKIPPING lib/name-card-tinos-metric-compat.integration.test.ts (3 tests) -- Chromium not installed, and this is not CI.\n" +
      "  Run: npx playwright install chromium\n",
  );
}

// Read the real stack AND the real @font-face CSS from source, rather than
// hardcoding either here. A first version of this test reconstructed its
// own FontFace() declarations with hand-copied URLs -- which meant breaking
// studio.tsx's own @font-face block (a wrong path, the exact mistake this
// test exists to catch) left every assertion here passing anyway, because
// the test was never exercising the component's own CSS. Caught by mutating
// the real file and finding the test didn't notice. Fixed by injecting the
// component's own <style> block verbatim instead of restating it.
const STUDIO_SRC = readFileSync("components/name-card/studio.tsx", "utf8");
const REAL_STACK = (() => {
  const m = STUDIO_SRC.match(/const TIMES_NEW_ROMAN = "([^"]+)"/);
  if (!m) throw new Error("TIMES_NEW_ROMAN constant not found in studio.tsx -- this test can't verify a stack it can't read.");
  return m[1];
})();
const TINOS_FONT_FACE_CSS = (() => {
  const blocks = [...STUDIO_SRC.matchAll(/@font-face\s*\{[^}]*font-family:\s*'Tinos'[^}]*\}/g)].map((m) => m[0]);
  if (blocks.length !== 2) throw new Error(`Expected exactly 2 Tinos @font-face blocks in studio.tsx, found ${blocks.length} -- this test can't verify CSS it can't read correctly.`);
  return blocks.join("\n");
})();

const PORT = 20000 + (parseInt(createHash("sha256").update(process.cwd() + ":tinos").digest("hex").slice(0, 8), 16) % 10000);
const BASE_URL = `http://localhost:${PORT}`;

describe.skipIf(!CHROMIUM_INSTALLED)("Tinos metric-compatibility -- rendered width independent of OS fonts", () => {
  let serverProcess: ReturnType<typeof spawn> | null = null;
  let browser: Browser | null = null;

  async function waitForServer(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.status > 0) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
  }

  beforeAll(async () => {
    serverProcess = spawn("pnpm", ["exec", "next", "dev", "-p", String(PORT)], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: "pipe",
      detached: true,
    });
    await waitForServer(`${BASE_URL}/login`, 60_000);
    browser = await chromium.launch({ headless: true });
  }, 90_000);

  afterAll(async () => {
    await browser?.close();
    if (serverProcess?.pid) {
      try {
        process.kill(-serverProcess.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }, 20_000);

  /**
   * Measures one probe string's width in a fresh, anonymous browser context.
   * Injects studio.tsx's own @font-face CSS verbatim (via page.addStyleTag,
   * not a hand-rebuilt FontFace()) so a broken path/family/format in the
   * REAL component is what this test is actually exercising.
   */
  async function measure(fontFamilyStack: string, text: string): Promise<number> {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: TINOS_FONT_FACE_CSS });
    const width = await page.evaluate(async ({ stack, text }) => {
      // Canvas text does not trigger a @font-face load the way DOM text does --
      // measureText() silently uses whatever is ALREADY resolved at the moment
      // it's called, with no error if the real face never finished loading.
      // document.fonts.load() explicitly triggers and awaits it (document.fonts
      // .ready only settles pending loads that were already triggered some
      // other way, and -- per the fonts.ready vs fonts.check() trap this repo
      // already hit once -- is not itself proof a load succeeded).
      await document.fonts.load(`italic 29px ${stack}`);
      const canvas = document.createElement("canvas");
      const c = canvas.getContext("2d")!;
      c.font = `italic 29px ${stack}`;
      return c.measureText(text).width;
    }, { stack: fontFamilyStack, text });
    await ctx.close();
    return width;
  }

  const PROBE_TEXT = "Sales Manager · 销售经理";
  const NONEXISTENT = "ZZ-Tinos-Kit-Nonexistent-Family-ZZ";

  it("control: the measurement technique discriminates at all (two genuinely different stacks give different widths)", async () => {
    const tinos = await measure(REAL_STACK, PROBE_TEXT);
    const genericOnly = await measure("monospace", PROBE_TEXT);
    expect(tinos).not.toBeCloseTo(genericOnly, 0);
  }, 20_000);

  it("Tinos alone determines the width -- swapping out every OTHER entry (simulating a device with none of them) measures identically", async () => {
    // Keeps 'Tinos' (the self-hosted, always-present entry) and fakes out
    // everything after it that depends on the OS actually having the font --
    // this is the Android case, reproduced on this box instead of a phone.
    const withOsFonts = await measure(REAL_STACK, PROBE_TEXT);
    const osFontsUnavailable = REAL_STACK.replace(/'Times New Roman'/, `'${NONEXISTENT}-TNR'`).replace(/Georgia/, `'${NONEXISTENT}-Georgia'`);
    const withoutOsFonts = await measure(osFontsUnavailable, PROBE_TEXT);
    expect(withoutOsFonts).toBeCloseTo(withOsFonts, 1);
  }, 20_000);

  it("demonstrates the pre-fix defect directly: the OLD stack (no self-hosted face) could NOT tell real Times New Roman apart from nothing at all, on this box", async () => {
    // The stack as it shipped before this kit -- kept here only as the
    // literal pre-fix value, to prove this probe would have caught it, not
    // because this component still uses it.
    const PRE_FIX_STACK = "'Times New Roman', Georgia, serif";
    const preFixReal = await measure(PRE_FIX_STACK, PROBE_TEXT);
    const preFixAllFaked = await measure(`'${NONEXISTENT}-1', '${NONEXISTENT}-2', serif`, PROBE_TEXT);
    // Equal here means: on a machine lacking Times New Roman and Georgia
    // (this box, same as Android), the pre-fix "real" stack was already
    // indistinguishable from having named no font at all -- zero actual
    // protection against whatever generic serif the platform supplies.
    expect(preFixReal).toBeCloseTo(preFixAllFaked, 1);
  }, 20_000);
});
