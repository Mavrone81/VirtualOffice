import { PrismaClient } from "@prisma/client";

/** Vitest globalSetup: prove the integration suite's database is reachable, ONCE, before
 *  any test file loads — the same discipline as lib/test-support/env-preflight.ts, extended
 *  from "is DATABASE_URL a well-formed string" to "does it actually answer".
 *
 *  🔴 The problem this closes: DATABASE_URL being a non-empty string (env-preflight's check)
 *  says nothing about whether a server is listening at the other end. Without this check, a
 *  DB-dependent test file's own `beforeAll` is the first thing to find that out — and when
 *  `beforeAll` throws, vitest marks every test in that file SKIPPED, not FAILED. Measured
 *  directly against this suite with no database running: the commission money-path tests
 *  (server/commission/product-sales.integration.test.ts and friends) printed
 *
 *      Test Files  1 failed (1)
 *           Tests  6 skipped (6)
 *
 *  "skipped" reads like a deliberate, intentional skip — this repo already has real ones
 *  (describe.skipIf(!CHROMIUM_INSTALLED)) — not like "the thing that guarantees commission
 *  math can't move money already earned never ran". Run the full suite the same way and the
 *  per-file noise compounds into one deceptively survivable-looking line: 421 "skipped"
 *  buried under 1167 "passed". A reader checking only that line sees a mostly-green run that
 *  proved nothing about money.
 *
 *  This check runs BEFORE any of that: one real query, bounded by an explicit timeout so a
 *  network path that silently drops packets (no RST, no refusal) fails loud on OUR clock
 *  instead of hanging on the OS's. Failing here means the whole project refuses to even start
 *  collecting tests — no per-file skip noise, one banner, naming exactly what is missing.
 */
const CONNECT_TIMEOUT_MS = 10_000;

function targetDescription(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "(DATABASE_URL could not be parsed as a URL)";
  }
}

function banner(lines: string[]): string {
  return [
    "",
    "=".repeat(78),
    "DATABASE PREFLIGHT FAILED — the integration test run is stopping before it starts.",
    "",
    ...lines,
    "",
    "Nothing has been measured. Every DB-dependent test in this project would otherwise",
    "have hit this same failure inside its own beforeAll, one file at a time, each one",
    "reported as SKIPPED rather than FAILED — easy to misread as tests that chose not to",
    "run, instead of tests that could not prove anything.",
    "",
    "Fix: start the project's dev database, then re-run.",
    "  docker compose up -d db          # brings up Postgres on the port in .env.example",
    "Already have DATABASE_URL pointed somewhere else? Confirm that server is actually up",
    "and reachable from here before re-running.",
    "",
    "Just want the DB-independent unit tests while you sort that out? `pnpm test` runs every",
    "vitest project together, and one project's globalSetup failing here stops that whole run",
    "before any project (including the ones that don't need a database) collects a single",
    "test — that's vitest's own behavior, not a bug in this check. Run `pnpm test:unit` instead.",
    "=".repeat(78),
    "",
  ].join("\n");
}

export default async function dbPreflight() {
  const databaseUrl = process.env.DATABASE_URL;
  // env-preflight.ts (which always runs first — see vitest.config.ts) already fails the run
  // if this is absent or empty. Checked again here, defensively, so this file never assumes
  // load order it does not control.
  if (!databaseUrl) {
    console.error(banner(["DATABASE_URL is not set."]));
    throw new Error("Database preflight failed: DATABASE_URL is not set");
  }

  const target = targetDescription(databaseUrl);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS);
  });

  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      banner([
        `Could not reach Postgres at ${target}.`,
        "",
        `Reason: ${reason}`,
      ]),
    );
    throw new Error(`Database preflight failed: could not reach Postgres at ${target} (${reason})`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}
