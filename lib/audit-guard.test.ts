import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

// Audit reliability (reviews/audit-reliability.md, step 5): money, payee,
// security and PII code must audit through auditTx inside the action's own
// transaction (Tier A), never the best-effort logAudit — so new code in these
// areas can't quietly regress to "the action happened, its record may not
// have". A line may still call logAudit only when it carries an explicit
// `tier-b-ok: <reason>` annotation (e.g. a run summary whose every entry was
// already audited atomically). Test files are exempt.
const ROOT = join(__dirname, "..");
const TIER_A = [
  "server/invoices", "server/payouts", "server/commission", "server/sales", "server/vouchers",
  "server/products", "server/account", "server/associates",
  "server/pii.ts", "server/pii-nric-backfill.ts",
  "app/portal/quotations/actions.ts",
  "scripts",
];

function sourceFiles(path: string): string[] {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return []; // e.g. server/vouchers before A-7 lands — covered as soon as it does
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(path, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(abs, e.name)] : [],
  );
}

describe("audit guard: no best-effort logAudit in Tier-A code", () => {
  it("every logAudit( call in a Tier-A path is annotated tier-b-ok", () => {
    const offenders: string[] = [];
    for (const p of TIER_A) {
      for (const file of sourceFiles(p)) {
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          if (/tier-b-ok:/.test(line)) return; // explicitly annotated Tier-B call
          const trimmed = line.trim();
          if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return; // block-comment prose
          const code = line.replace(/\/\/.*$/, ""); // drop trailing // comments
          if (/\blogAudit\s*\(/.test(code)) offenders.push(`${relative(ROOT, file)}:${i + 1}`);
        });
      }
    }
    expect(offenders, "use auditTx inside the action's transaction (reviews/audit-reliability.md)").toEqual([]);
  });

  it("actually scans the Tier-A code (the guard can't pass vacuously)", () => {
    const files = TIER_A.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(join("server", "payouts", "actions.ts")))).toBe(true);
  });

  // DevLead: every test-only helper (lib/test-*.ts: fault injection, fixtures, …)
  // stays out of production code. Only REAL import/require statements count — a
  // comment naming a helper isn't an import. Test files and other lib/test-*.ts
  // helpers may import them.
  const helperNames = () =>
    readdirSync(join(ROOT, "lib")).filter((n) => /^test-.*\.ts$/.test(n) && !/\.test\.ts$/.test(n)).map((n) => n.replace(/\.ts$/, ""));

  function importedTestHelpers(source: string, helpers: string[]): string[] {
    const specs = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)].map((m) => m[1]);
    return helpers.filter((h) => specs.some((spec) => spec.replace(/\.tsx?$/, "").split("/").pop() === h));
  }

  it("the import matcher counts real imports only, not a comment naming a helper", () => {
    const helpers = ["test-audit-fault", "test-fixtures"];
    expect(importedTestHelpers(`// see lib/test-audit-fault.ts for how failures are injected`, helpers)).toEqual([]);
    expect(importedTestHelpers(`import { failAuditsFor } from "@/lib/test-audit-fault";`, helpers)).toEqual(["test-audit-fault"]);
    expect(importedTestHelpers(`const f = await import("./test-fixtures");`, helpers)).toEqual(["test-fixtures"]);
    expect(importedTestHelpers(`const x = require('../lib/test-audit-fault.ts');`, helpers)).toEqual(["test-audit-fault"]);
    expect(importedTestHelpers(`import "@/lib/test-fixtures";`, helpers)).toEqual(["test-fixtures"]);
  });

  it("no lib/test-*.ts helper is imported by production code (app/, server/, scripts/, non-test lib/)", () => {
    const helpers = helperNames();
    expect(helpers).toContain("test-audit-fault"); // not vacuous
    const prodFiles = ["app", "server", "lib", "scripts"].flatMap(sourceFiles)
      .filter((f) => !/[\\/]lib[\\/]test-[^\\/]*\.ts$/.test(f)); // helpers may import each other
    const offenders = prodFiles.flatMap((f) => importedTestHelpers(readFileSync(f, "utf8"), helpers).map((h) => `${relative(ROOT, f)} → ${h}`));
    expect(offenders).toEqual([]);
  });
});
