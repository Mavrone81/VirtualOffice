import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeEmail } from "./email";

/**
 * A user who cannot log in, with nothing anywhere reporting a problem.
 *
 * Login resolves `email.toLowerCase().trim()`; the write paths stored what was
 * typed; PostgreSQL compares case-sensitively. So "Louisewsf@gmail.com" was
 * unreachable by any login attempt while the account looked perfectly healthy —
 * active, correct password, admin resets succeeding. Five of twenty-five users
 * were locked out this way before one of them said so.
 *
 * The first half of this file tests the helper. The second half is the part
 * that matters: it scans for email writes that skipped it, taking its
 * denominator from the source tree rather than from a list of the places I
 * happened to remember.
 */
const ROOT = join(__dirname, "..");

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Louisewsf@Gmail.COM ")).toBe("louisewsf@gmail.com");
  });

  it("maps absent and blank to null, so a stored empty string cannot masquerade as an address", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
  });

  it("is idempotent — re-normalising an already stored value changes nothing", () => {
    const once = normalizeEmail("A@B.com");
    expect(normalizeEmail(once)).toBe(once);
  });

  it("matches what the login path computes, which is the whole point", () => {
    const typedAtLogin = "  Louisewsf@gmail.com ".toLowerCase().trim();
    expect(normalizeEmail("Louisewsf@gmail.com")).toBe(typedAtLogin);
  });
});

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) serverFiles(full, out);
    else if (name.endsWith(".ts") && !name.includes(".test.")) out.push(full);
  }
  return out;
}

describe("no server path writes or looks up an email without normalising it", () => {
  const files = serverFiles(join(ROOT, "server"));

  it("the scan finds email handling at all (control)", () => {
    const hits = files.filter((f) => /email:/.test(readFileSync(f, "utf8")));
    expect(hits.length).toBeGreaterThan(2);
  });

  // Raw `email: <expr>,` inside a Prisma data/where block is the shape that
  // caused this. A literal or a normalizeEmail() call is fine.
  it("no raw email in a Prisma data/where block without normalising", () => {
    // Scoped to Prisma `data:` / `where:` blocks, which is where storing or
    // finding by a non-normalised address actually does damage. A return value
    // or a validation call carrying `email:` is not a defect.
    //
    // It matches anywhere on the line AND looks back a few lines, because the
    // write that caused the outage sat inline in a one-line `data: {...}` while
    // other blocks put `email:` on its own line under `data: {`. An earlier
    // version anchored to line start, missed the real one, and passed. The
    // mutant that reverts that write is the test for this test.
    // `insensitive` is a Prisma case-insensitive SEARCH filter (downline lookup),
    // which is the correct way to match a typed query and not a stored value.
    const ALLOWED = new Set(["true", "false", "null", "undefined", "string", "normalizeEmail", "insensitive"]);
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
        if (!/\b(data|where):\s*\{/.test(context)) continue;
        for (const m of line.matchAll(/\bemail:\s*([A-Za-z_][\w.?]*)/g)) {
          if (ALLOWED.has(m[1])) continue;
          // A local already carrying the normalised value. The convention is
          // the escape hatch: name it `normalized...` and the guarantee is
          // readable at the point of use rather than three lines up.
          if (/^normalized/i.test(m[1])) continue;
          offenders.push(`${f.slice(ROOT.length + 1)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders, "wrap it in normalizeEmail() from lib/email.ts").toEqual([]);
  });

  // The database refuses a non-lowercase row regardless, so the guard does not
  // rest on this scan alone.
  it("the lowercase CHECK constraint ships as a migration", () => {
    const migrations = join(ROOT, "prisma/migrations");
    const sql = readdirSync(migrations)
      .filter((d) => statSync(join(migrations, d)).isDirectory())
      .map((d) => {
        try { return readFileSync(join(migrations, d, "migration.sql"), "utf8"); } catch { return ""; }
      })
      .join("\n");
    expect(sql).toContain("users_email_is_lowercase");
    expect(sql).toContain("associates_email_is_lowercase");
  });
});
