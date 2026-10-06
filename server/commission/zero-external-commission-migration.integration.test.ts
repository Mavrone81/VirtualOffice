// item 4 follow-up, Part 1 (+ re-propagation follow-up). Needs a local PG
// (DATABASE_URL); fake data only, all rows tagged and cleaned up. Reads the
// REAL migration.sql file from disk and executes it against real rows,
// rather than re-typing its SQL here — a copy could drift from what
// actually ships.
//
// RUN AGAINST A DISPOSABLE POSTGRES ONLY. This migration's UPDATEs are not
// scoped by row id — the first touches every row in commission_structure_versions
// whose snapshot says external, the second touches every row in products
// whose own is_external is true. Running this file against a shared dev
// database zeros every REAL external row's rates in it; this file's own
// cleanup (afterAll below) only deletes the rows it tagged, not whatever
// else the migration touched.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { Designation, CommissionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toLineInput } from "./inputs";
import { computeLineCommission } from "./engine";
import { negativeLines } from "./split-bounds";

const TAG = "ZEROMIG-";
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/20261006050000_zero_external_commission_rate_snapshot/migration.sql"),
  "utf8",
);

// The migration file now carries TWO top-level UPDATE statements (the
// re-propagation follow-up added the second). Prisma's $executeRawUnsafe
// sends its argument over the extended/prepared-statement protocol, which
// Postgres refuses outright for more than one statement ("cannot insert
// multiple commands into a prepared statement") — it's not that the second
// statement is silently skipped, every test in this file errors before any
// assertion runs. Strips `--` comment lines (several contain a literal `;`
// as ordinary punctuation, which a naive split on the raw text would
// misread as a statement boundary) and runs what's left as separate
// statements in one transaction — closer to what a real deploy does with a
// multi-statement migration file than firing the whole blob through the
// single-statement raw-query path this file originally used for Part 1,
// back when there was only one statement to run.
// LIMIT, for whoever edits migration.sql next: the split below is textual, so a
// `;` inside a STRING LITERAL would be misread as a statement boundary and this
// file would fail at the SQL call rather than on an assertion. No literal in the
// current file contains one ('"0"', '{closingCommPct}', 'true'). If you add one
// that does, this helper needs a real parser, not a wider regex.
function migrationStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}
async function runMigration() {
  const statements = migrationStatements(MIGRATION_SQL);
  await prisma.$transaction(statements.map((s) => prisma.$executeRawUnsafe(s)));
}

async function insertSnapshot(productCode: string, rateSnapshot: Record<string, unknown>) {
  await prisma.commissionStructureVersion.create({
    data: { productCode, effectiveDate: new Date("2026-01-01"), rateSnapshot: rateSnapshot as never },
  });
}
async function readSnapshot(productCode: string): Promise<Record<string, unknown>> {
  const row = await prisma.commissionStructureVersion.findFirst({ where: { productCode }, orderBy: { createdAt: "desc" } });
  return row!.rateSnapshot as Record<string, unknown>;
}

// Plain numeric Product-row fields — deliberately not reusing insertSnapshot's
// JSON shape; the products table is "numeric" columns, not JSON strings.
async function insertProduct(productCode: string, fields: {
  isExternal: boolean; closingCommPct?: string | null; closingCommFixed?: string | null;
  companyCutPct?: string; smOverridePct?: string; sdOverridePct?: string;
}): Promise<string> {
  const row = await prisma.product.create({
    data: {
      productCode, productName: "Zero-Migration Fixture", commissionType: CommissionType.Percentage,
      closingCommPct: fields.closingCommPct ?? "100", closingCommFixed: fields.closingCommFixed ?? null,
      companyCutPct: fields.companyCutPct ?? "10", smOverridePct: fields.smOverridePct ?? "3", sdOverridePct: fields.sdOverridePct ?? "2",
      isExternal: fields.isExternal, effectiveDate: new Date("2026-01-01"),
    },
    select: { id: true },
  });
  return row.id;
}
async function readProductRow(productCode: string) {
  return prisma.product.findFirstOrThrow({
    where: { productCode },
    select: { closingCommPct: true, closingCommFixed: true, companyCutPct: true, smOverridePct: true, sdOverridePct: true, isExternal: true },
  });
}
// Mirrors app/admin/products/[id]/edit/page.tsx:73-87's own conversion
// line-for-line (not new logic) — this is literally what the edit screen
// would prefill from this row, post-migration.
function asEditScreenWouldPrefill(row: Awaited<ReturnType<typeof readProductRow>>) {
  return {
    closingCommPct: row.closingCommPct?.toString(),
    closingCommFixed: row.closingCommFixed?.toFixed(2),
    companyCutPct: row.companyCutPct.toString(),
    smOverridePct: row.smOverridePct.toString(),
    sdOverridePct: row.sdOverridePct.toString(),
  };
}

afterAll(async () => {
  // Products first: no fixture here sets commissionStructureVersion.productId,
  // so there is no FK ordering requirement, but deleting in this order keeps
  // it true even if that changes later.
  await prisma.product.deleteMany({ where: { productCode: { startsWith: TAG } } });
  await prisma.commissionStructureVersion.deleteMany({ where: { productCode: { startsWith: TAG } } });
});

describe("migration 20261006050000_zero_external_commission_rate_snapshot", () => {
  // The exact PETCRE shape from the brief: closing 100 / cut 10 / SM 3 / SD
  // 2, Percentage, retained 0. Asserts the post-migration ENGINE OUTPUT
  // directly — provider = sale, closer 0, no override lines, company 0,
  // negativeLines empty — not just that the stored JSON looks zeroed.
  it("zeros a legacy-shaped EXTERNAL Percentage snapshot; the post-migration engine output is provider = sale, closer 0, company 0, no overrides, negativeLines empty", async () => {
    const code = TAG + "PETCRE";
    await insertSnapshot(code, {
      commissionType: "Percentage", closingCommPct: "100", closingCommFixed: null,
      companyCutPct: "10", companyCutType: "Percentage",
      smOverridePct: "3", smOverrideType: "Percentage",
      sdOverridePct: "2", sdOverrideType: "Percentage",
      isExternal: true, externalCompanyRetainedPct: "0",
    });

    await runMigration();

    const snap = await readSnapshot(code);
    expect(snap).toMatchObject({
      closingCommPct: "0", closingCommFixed: "0", companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0",
      isExternal: true, externalCompanyRetainedPct: "0",
    });

    const input = toLineInput(
      { id: "line-1", commissionType: CommissionType.Percentage, lineSaleAmount: "188.00", isExternal: true, selectedComCodes: null },
      snap,
      {
        closer: { associateId: "closer-1", designation: Designation.SalesAssociate },
        directUpline: { associateId: "sm-1", designation: Designation.SalesManager, eligible: true },
        secondUpline: { associateId: "sd-1", designation: Designation.SalesDirector, eligible: true },
        associate2: null, associate3: null,
      },
    );
    const r = computeLineCommission(input);
    expect(r.reconciles).toBe(true);
    expect(r.lines.find((l) => l.lineType === "ExternalPayable")!.amount.toString()).toBe("188");
    expect(r.lines.find((l) => l.lineType === "Personal")!.amount.toString()).toBe("0");
    expect(r.lines.filter((l) => l.lineType === "Override")).toHaveLength(0);
    expect(r.lines.find((l) => l.lineType === "CompanyRetained")!.amount.toString()).toBe("0");
    expect(negativeLines("PETCRE", r)).toEqual([]);
  });

  // The scoping: a snapshot whose own isExternal is false must be untouched,
  // asserted field-by-field against the exact pre-migration values — not assumed.
  it("the scoping: an INTERNAL snapshot (isExternal false) is untouched", async () => {
    const code = TAG + "INTERNAL1";
    const original = {
      commissionType: "Percentage", closingCommPct: "100", closingCommFixed: null,
      companyCutPct: "10", companyCutType: "Percentage",
      smOverridePct: "3", smOverrideType: "Percentage",
      sdOverridePct: "2", sdOverrideType: "Percentage",
      isExternal: false, externalCompanyRetainedPct: null,
    };
    await insertSnapshot(code, original);
    await runMigration();
    const snap = await readSnapshot(code);
    expect(snap).toEqual(original);
  });

  // closingCommFixed: a Fixed-commission external snapshot must have it
  // zeroed too, not left exposed — this is the field PD's four-field list
  // did not include and the brief adds explicitly.
  it("a Fixed-commission EXTERNAL snapshot: closingCommFixed is zeroed, not left exposed", async () => {
    const code = TAG + "EXTFIXED";
    await insertSnapshot(code, {
      commissionType: "Fixed", closingCommPct: null, closingCommFixed: "550",
      companyCutPct: "50", companyCutType: "Absolute",
      smOverridePct: "30", smOverrideType: "Absolute",
      sdOverridePct: "20", sdOverrideType: "Absolute",
      isExternal: true, externalCompanyRetainedPct: "5",
    });
    await runMigration();
    const snap = await readSnapshot(code);
    expect(snap).toMatchObject({ closingCommFixed: "0", closingCommPct: "0", companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0" });
  });

  // Every rate field stays the same JSON type the engine's inputs.ts
  // expects from every other row — a bare 0 here would hand toLineInput a
  // number where every other row holds a string.
  it("every zeroed field is a JSON string, isExternal stays a JSON boolean", async () => {
    const code = TAG + "TYPECHECK";
    await insertSnapshot(code, {
      commissionType: "Percentage", closingCommPct: "100", closingCommFixed: null,
      companyCutPct: "10", companyCutType: "Percentage",
      smOverridePct: "3", smOverrideType: "Percentage",
      sdOverridePct: "2", sdOverrideType: "Percentage",
      isExternal: true, externalCompanyRetainedPct: "0",
    });
    await runMigration();
    const rows = await prisma.$queryRawUnsafe<{ t: string }[]>(
      `SELECT jsonb_typeof(rate_snapshot->'closingCommPct') || ',' || jsonb_typeof(rate_snapshot->'closingCommFixed') || ',' ||
              jsonb_typeof(rate_snapshot->'companyCutPct') || ',' || jsonb_typeof(rate_snapshot->'smOverridePct') || ',' ||
              jsonb_typeof(rate_snapshot->'sdOverridePct') || ',' || jsonb_typeof(rate_snapshot->'isExternal') AS t
       FROM commission_structure_versions WHERE product_code = $1`,
      code,
    );
    expect(rows[0].t).toBe("string,string,string,string,string,boolean");
  });
});

// The re-propagation follow-up: the migration's SECOND statement, zeroing
// the Product row itself. PD's measured defect — the migration zeroed the
// snapshot but left the Product row (which the edit screen prefills from)
// untouched, so an unrelated edit silently wrote a fresh snapshot carrying
// the old live values right back in.
describe("migration 20261006050000_zero_external_commission_rate_snapshot — products table (re-propagation close)", () => {
  it("an EXTERNAL product row (100/10/3/2, closingCommFixed set) has all five columns zeroed", async () => {
    const code = TAG + "PRODEXT";
    await insertProduct(code, { isExternal: true, closingCommPct: "100", closingCommFixed: "500", companyCutPct: "10", smOverridePct: "3", sdOverridePct: "2" });
    await runMigration();
    const row = await readProductRow(code);
    expect(row.closingCommPct?.toString()).toBe("0");
    expect(row.closingCommFixed?.toString()).toBe("0");
    expect(row.companyCutPct.toString()).toBe("0");
    expect(row.smOverridePct.toString()).toBe("0");
    expect(row.sdOverridePct.toString()).toBe("0");
  });

  // Field-by-field against the EXACT pre-migration values, not toMatchObject
  // on a subset — an internal row must be untouched, not merely "close".
  it("an INTERNAL product row (100/10/3/2) is untouched — field by field, not a subset", async () => {
    const code = TAG + "PRODINT";
    await insertProduct(code, { isExternal: false, closingCommPct: "100", closingCommFixed: null, companyCutPct: "10", smOverridePct: "3", sdOverridePct: "2" });
    await runMigration();
    const row = await readProductRow(code);
    expect(row.closingCommPct?.toString()).toBe("100");
    expect(row.closingCommFixed).toBeNull();
    expect(row.companyCutPct.toString()).toBe("10");
    expect(row.smOverridePct.toString()).toBe("3");
    expect(row.sdOverridePct.toString()).toBe("2");
    expect(row.isExternal).toBe(false);
  });

  // THE INVERSION — the case that proves the scoping was understood, not
  // just copy-pasted. Product row says external; its (separately-stored)
  // snapshot says internal. The row is zeroed (it's external TODAY); the
  // snapshot is left alone (it was never external, by its own account).
  it("inversion: product row is_external=TRUE but the matching snapshot says isExternal=false — the ROW zeros, the SNAPSHOT doesn't", async () => {
    const code = TAG + "INVERT-A";
    await insertProduct(code, { isExternal: true, closingCommPct: "100", companyCutPct: "10", smOverridePct: "3", sdOverridePct: "2" });
    const snapshotBefore = {
      commissionType: "Percentage", closingCommPct: "100", closingCommFixed: null,
      companyCutPct: "10", companyCutType: "Percentage", smOverridePct: "3", smOverrideType: "Percentage",
      sdOverridePct: "2", sdOverrideType: "Percentage", isExternal: false, externalCompanyRetainedPct: null,
    };
    await insertSnapshot(code, snapshotBefore);

    await runMigration();

    const row = await readProductRow(code);
    expect(row.closingCommPct?.toString()).toBe("0");
    expect(row.companyCutPct.toString()).toBe("0");
    expect(row.smOverridePct.toString()).toBe("0");
    expect(row.sdOverridePct.toString()).toBe("0");
    const snap = await readSnapshot(code);
    expect(snap).toEqual(snapshotBefore); // untouched — its own isExternal is false
  });

  // THE MIRROR of the inversion: product row says internal; its snapshot
  // says external. The snapshot zeros (it's external by its own account);
  // the row is left alone (it's internal today).
  it("mirror: product row is_external=FALSE but the matching snapshot says isExternal=true — the SNAPSHOT zeros, the ROW doesn't", async () => {
    const code = TAG + "INVERT-B";
    await insertProduct(code, { isExternal: false, closingCommPct: "100", companyCutPct: "10", smOverridePct: "3", sdOverridePct: "2" });
    await insertSnapshot(code, {
      commissionType: "Percentage", closingCommPct: "100", closingCommFixed: null,
      companyCutPct: "10", companyCutType: "Percentage", smOverridePct: "3", smOverrideType: "Percentage",
      sdOverridePct: "2", sdOverrideType: "Percentage", isExternal: true, externalCompanyRetainedPct: "5",
    });

    await runMigration();

    const row = await readProductRow(code);
    expect(row.closingCommPct?.toString()).toBe("100");
    expect(row.companyCutPct.toString()).toBe("10");
    expect(row.smOverridePct.toString()).toBe("3");
    expect(row.sdOverridePct.toString()).toBe("2");
    expect(row.isExternal).toBe(false);
    const snap = await readSnapshot(code);
    expect(snap).toMatchObject({ closingCommPct: "0", companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0" });
  });

  // The end-to-end point: what the EDIT SCREEN would actually prefill, post-
  // migration, is zero — not a re-derivation of the stored row, but the same
  // .toString()/.toFixed(2) conversion app/admin/products/[id]/edit/page.tsx
  // itself applies (lines 73-87) to build the form's initial CommissionValue.
  it("end-to-end: the values the edit screen would prefill for a migrated external product are all zero", async () => {
    const code = TAG + "PRODSCREEN";
    await insertProduct(code, { isExternal: true, closingCommPct: "100", closingCommFixed: "500", companyCutPct: "10", smOverridePct: "3", sdOverridePct: "2" });
    await runMigration();
    const prefill = asEditScreenWouldPrefill(await readProductRow(code));
    expect(prefill).toEqual({
      closingCommPct: "0", closingCommFixed: "0.00", companyCutPct: "0", smOverridePct: "0", sdOverridePct: "0",
    });
  });
});
