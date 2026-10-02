// Fonts-matcher hardening (02 Oct 2026) -- the two checks a pure matcher-
// pattern test (lib/middleware-fonts-matcher.test.ts) CANNOT make, because
// they're not about what regex the matcher uses, they're about what
// actually happens on the wire and in a real browser's font engine once a
// request gets past it:
//
//  1. A non-existent path under /fonts must 404, not synthesize content --
//     excluding /fonts/** from the auth matcher must not accidentally
//     exclude it from Next's normal "no such file" handling too.
//  2. The font genuinely LOADS and is usable, for a truly anonymous browser
//     (zero session cookies) -- proven with document.fonts.check(), never
//     fonts.ready (ready resolves on a FAILED load too -- the check C-1
//     used, and why this file exists). A green matcher-pattern suite with
//     no font-load coverage is exactly how a regex that LOOKS right but a
//     server that doesn't actually serve the bytes correctly would ship
//     unnoticed -- this is the specific gap that class of bug hides in.
//
// Boots a real `next dev` server as a child process and drives it with a
// real Chromium (via the `playwright` package, managed browser install --
// NOT a machine-specific cached path, so this runs the same way in CI as
// here: `npx playwright install chromium` fetches the matching build).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

// Locally, `pnpm install` alone does NOT fetch Chromium (playwright's
// postinstall only prints a reminder, doesn't download) -- without a probe
// these 5 tests hard-fail with a browser-launch error on a clean clone,
// reading as "the fix is broken" rather than "the browser isn't installed
// yet". Skip in that case ONLY -- and only locally. In CI, `env.CI` is
// always "true" (GitHub Actions sets it on every runner) and the workflow
// installs Chromium before this file runs, so a missing browser THERE means
// the install step itself silently failed -- skipping would hide exactly
// that, which is how a real check gets switched off without anyone
// deciding to switch it off. So: missing + CI => hard fail (thrown, not
// skipped); missing + not CI => skip, loudly (vitest.config.ts already
// carries a zero-collected-reporter for the "a skip reads as a quiet pass"
// failure mode -- this follows the same discipline).
// Gates the beforeAll/afterAll below too (not just the tests) -- both live
// INSIDE the describe.skipIf block, so a skipped suite never spawns a
// server or touches chromium.launch() at all.
const CHROMIUM_INSTALLED = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
if (!CHROMIUM_INSTALLED && process.env.CI) {
  throw new Error(
    "lib/middleware-fonts-live.integration.test.ts: Chromium is not installed, and CI is set. " +
      "The workflow's 'Install Chromium' step should have run before this file -- failing loudly " +
      "instead of skipping, since a skip here would hide that step actually failing.",
  );
}
if (!CHROMIUM_INSTALLED) {
  console.warn(
    "\n⚠ SKIPPING lib/middleware-fonts-live.integration.test.ts (5 tests) -- Chromium not installed, and this is not CI.\n" +
      "  Run: npx playwright install chromium\n" +
      "  Expected on a fresh local clone. In CI this would hard-fail instead (see ci-cd.yml) -- a skip there would hide a broken install step.\n",
  );
}

// A fixed port collides the moment two worktrees run this file at once (the
// normal case here -- gating and pre-staging routinely overlap). Derive one
// deterministically from the worktree's own path instead: stable across
// re-runs of the SAME worktree (so a human watching logs sees a consistent
// port), different across worktrees. 20000-29999 avoids this repo's other
// fixed dev ports (10502 etc.) entirely rather than just hoping not to
// collide with whichever happens to be running right now.
const PORT = 20000 + (parseInt(createHash("sha256").update(process.cwd()).digest("hex").slice(0, 8), 16) % 10000);
const BASE_URL = `http://localhost:${PORT}`;

describe.skipIf(!CHROMIUM_INSTALLED)("fonts-matcher hardening -- live server behaviour, not just the matcher pattern", () => {
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
      detached: true, // own process group -- see afterAll: kill the GROUP, not just this pid
    });
    await waitForServer(`${BASE_URL}/login`, 60_000);
    browser = await chromium.launch({ headless: true });
  }, 90_000);

  afterAll(async () => {
    await browser?.close();
    // next dev spawns its own child (next-server) under the wrapper; killing
    // only serverProcess.pid leaves it running (the exact orphan class found
    // twice tonight by hand, via /proc/<pid>/cwd). `detached: true` above put
    // this process in its OWN process group, so a negative pid signals the
    // whole group -- the wrapper AND every child it spawned, in one call.
    if (serverProcess?.pid) {
      try {
        process.kill(-serverProcess.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }, 20_000);

  it("a non-existent path under /fonts 404s -- excluding the matcher doesn't synthesize content", async () => {
    const res = await fetch(`${BASE_URL}/fonts/does-not-exist-${Date.now()}.ttf`, { redirect: "manual" });
    expect(res.status).toBe(404);
  });

  it("the real font file is served anonymously (200, not a 302 to /login)", async () => {
    const res = await fetch(`${BASE_URL}/fonts/alex-brush/AlexBrush-Regular.ttf`, { redirect: "manual" });
    expect(res.status).toBe(200);
  });

  it("CONTROL -- a real protected page still 302s anonymously, proving this server's middleware is actually running and gating, not disabled", async () => {
    const res = await fetch(`${BASE_URL}/portal/dashboard`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("document.fonts.check() is true for a genuinely anonymous browser context -- the actual regression proof, not an API-level stand-in", async () => {
    const ctx = await browser!.newContext(); // fresh context: zero cookies, zero storage
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

    const result = await page.evaluate(async () => {
      const face = new FontFace("Alex Brush", "url('/fonts/alex-brush/AlexBrush-Regular.ttf')");
      document.fonts.add(face);
      await face.load();
      return document.fonts.check('52px "Alex Brush"');
    });

    expect(result).toBe(true);
    await ctx.close();
  }, 20_000);

  it("CONTROL -- check() correctly reports false for a font whose load() genuinely failed, proving it isn't vacuously true", async () => {
    // NOT "a family name nobody ever declared" -- per the Font Loading spec
    // (confirmed empirically: a never-added family returns check()===true
    // unconditionally, since the UA can always fall back to render SOMETHING
    // without a fetch; document.fonts.size===0 and it's still true). check()
    // only means something for a family with an actual tracked FontFace
    // entry. So the real control adds one pointing at a URL that 404s --
    // same shape as the real test above (add + load()), different outcome.
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

    const result = await page.evaluate(async () => {
      const face = new FontFace("Control Font That Will Fail To Load", "url('/fonts/does-not-exist-at-all.ttf')");
      document.fonts.add(face);
      try {
        await face.load();
      } catch {
        // expected -- 404
      }
      return document.fonts.check('52px "Control Font That Will Fail To Load"');
    });

    expect(result).toBe(false);
    await ctx.close();
  }, 20_000);
});
