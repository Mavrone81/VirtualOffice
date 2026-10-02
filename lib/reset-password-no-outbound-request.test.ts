import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import os from "os";

// #29: the single-use token lives in this page's own URL. A `fetch(`, an
// <img>/<script> tag, or an analytics call anywhere on this page would send
// it in a Referer header to wherever that request goes — Referrer-Policy
// (next.config.ts) is defence in depth, this is the property itself.
//
// app/** isn't in vitest's include globs (see lib/files-route.test.ts for the
// same reason), so this lives here and reads the page's source directly.
const PAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "reset-password", "[token]");

const FORBIDDEN_RE = /\bfetch\(|sendBeacon\(|<img\b|<script\b|\bgtag\(|posthog\./;

function forbiddenHits(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(new RegExp(FORBIDDEN_RE, "g"))) hits.push(m[0]);
  return hits;
}

describe("reset-password page — no outbound request carrying the token", () => {
  it("page.tsx and reset-form.tsx contain none of the forbidden patterns", () => {
    for (const file of ["page.tsx", "reset-form.tsx"]) {
      const text = readFileSync(join(PAGE_DIR, file), "utf8");
      expect(forbiddenHits(text)).toEqual([]);
    }
  });
});

describe("reset-password page — firing control (synthetic fixture)", () => {
  it("flags a planted fetch( / <img> / sendBeacon( as a violation", () => {
    const tmp = mkdtempSync(join(os.tmpdir(), "no-outbound-"));
    try {
      writeFileSync(join(tmp, "bad.tsx"), `fetch("/track?t=" + token);\n`);
      writeFileSync(join(tmp, "bad2.tsx"), `<img src={"/pixel?t=" + token} />\n`);
      writeFileSync(join(tmp, "ok.tsx"), `const r = await resetPassword(token, pw);\n`);

      expect(forbiddenHits(readFileSync(join(tmp, "bad.tsx"), "utf8"))).toEqual(["fetch("]);
      expect(forbiddenHits(readFileSync(join(tmp, "bad2.tsx"), "utf8"))).toEqual(["<img"]);
      expect(forbiddenHits(readFileSync(join(tmp, "ok.tsx"), "utf8"))).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
