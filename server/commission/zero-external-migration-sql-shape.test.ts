// Guards the SUBSET of SQL that the integration test's statement splitter can
// safely handle. No database: these are pure text assertions about the migration
// file on disk, so they belong in the `unit` project and run on every CI pass
// rather than only where a Postgres happens to be available.
//
// WHY THIS EXISTS. zero-external-commission-migration.integration.test.ts cannot
// hand migration.sql to prisma.$executeRawUnsafe whole — that goes over the
// extended/prepared-statement protocol, which Postgres refuses for more than one
// statement, and the file now has two. So that test STRIPS `--` comment lines and
// SPLITS on `;`. It therefore executes a DERIVED string, not the bytes that ship.
// The splitter is correct for the file as written, and writing a real SQL
// tokeniser in a test is the wrong trade — so instead we assert the file stays
// inside the subset the splitter is correct for.
//
// The case that makes this worth having is not a crash. A `--` INSIDE a
// multi-line string literal would be stripped, leaving a statement that still
// parses, still executes, and writes DIFFERENT DATA than the migration really
// contains — with every assertion in the integration test still green. A `;`
// inside a literal, by contrast, splits into invalid fragments and fails loudly.
// Precondition 1 is what catches the silent one.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/20261006050000_zero_external_commission_rate_snapshot/migration.sql"),
  "utf8",
);

// The same definition of "comment line" the splitter uses: first non-whitespace
// characters are `--`. Kept deliberately identical — a guard that disagrees with
// the thing it guards is not a guard.
const codeLines = SQL.split("\n").filter((line) => !/^\s*--/.test(line));

describe("migration.sql stays inside the subset the integration test's splitter handles", () => {
  it("precondition 1: no string literal spans a newline, so a `--` can never be stripped out of one", () => {
    const spanning = codeLines.filter((line) => (line.match(/'/g) ?? []).length % 2 !== 0);
    // An odd number of single quotes on a code line means a literal opens and
    // does not close on that line. Named so a failure says what to do.
    expect(spanning, "a string literal spans a newline — the comment stripper can now silently alter it").toEqual([]);
  });

  it("precondition 2: no `--` follows code on a line, so no statement is cut short and no comment becomes a statement", () => {
    const trailing = codeLines.filter((line) => /\S\s*--/.test(line));
    expect(trailing, "a trailing comment follows code — the splitter would emit a comment-only statement").toEqual([]);
  });

  it("shape: exactly two statements, both UPDATE", () => {
    const statements = codeLines
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(2);
    expect(statements.every((s) => s.toUpperCase().startsWith("UPDATE"))).toBe(true);
  });
});
