import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The migrator image must contain everything `prisma/seed.ts` imports.
 *
 * `prisma migrate reset` drops the database, re-applies the migrations and then
 * runs the seed. If the seed cannot resolve its imports, the reset has already
 * destroyed the data by the time it fails — leaving an empty database with no
 * accounts and a live site nobody can log into.
 *
 * This derives the required directories from the seed's OWN imports instead of
 * hardcoding a list, so adding a new import to the seed fails this test rather
 * than failing a production reset.
 */
describe("migrator image can run the seed", () => {
  const root = process.cwd();
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  const seed = readFileSync(join(root, "prisma/seed.ts"), "utf8");

  /** The migrator stage: from `FROM base AS migrator` to the next `FROM`. */
  const stage = (() => {
    const i = dockerfile.indexOf("FROM base AS migrator");
    expect(i, "migrator stage not found").toBeGreaterThan(-1);
    const next = dockerfile.indexOf("\nFROM ", i + 1);
    return next === -1 ? dockerfile.slice(i) : dockerfile.slice(i, next);
  })();

  /** Top-level directories the seed imports from, e.g. `../lib/crypto` -> `lib`. */
  const importedDirs = [...new Set(
    [...seed.matchAll(/from\s+"\.\.\/([a-zA-Z0-9_-]+)\//g)].map((m) => m[1]),
  )].sort();

  test("the seed imports at least one local directory (guard against a vacuous pass)", () => {
    // If this ever hits 0, the regex stopped matching and every assertion below
    // would pass over an empty list.
    expect(importedDirs.length).toBeGreaterThan(0);
  });

  test.each(importedDirs)("migrator stage COPYs %s/", (dir) => {
    expect(stage).toMatch(new RegExp(`^COPY\\s+${dir}\\s`, "m"));
  });

  test("migrator stage COPYs prisma/ (the seed and the migrations)", () => {
    expect(stage).toMatch(/^COPY\s+prisma\s/m);
  });

  test("tsx is resolvable: the seed runs via tsx, so node_modules must come in", () => {
    expect(stage).toMatch(/^COPY --from=deps \/app\/node_modules/m);
  });
});
