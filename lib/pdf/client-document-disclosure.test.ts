import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Client-facing documents must never carry internal money.
 *
 * Owner ruling, 8 Oct 2026: a quotation "will not show commision, upline
 * downline, MD fee, Company retain. It should only show what a client will pay
 * for services (product)". He then confirmed an invoice is a client bill too,
 * so the rule covers both.
 *
 * This is a disclosure rule, not a layout preference, and it is not symmetric
 * with other bugs: every one of those figures is computed per line and sits
 * immediately beside the data these documents render from, and a document that
 * has been emailed cannot be recalled. Hiding a figure with styling does not
 * count — text in a PDF or an HTML page stays extractable.
 *
 * The invoice template is already clean BY CONSTRUCTION: it renders from a
 * narrow named `Line`/`Letterhead` type rather than a whole row. Nothing
 * asserted that, so widening those types would have leaked on the next render
 * with no test failing. That is what this file is for.
 */
const ROOT = join(__dirname, "..", "..");

/** Taken from the commission columns and ledger line types, not hand-invented:
 *  these are the figures the engine computes alongside what a client may see. */
const FORBIDDEN = [
  "commission", "companyCut", "company_cut", "companyRetained", "company_retained",
  "smOverride", "sm_override", "sdOverride", "sd_override",
  "mdCut", "md_cut", "managingDirector", "ManagingDirectorCut",
  "netToCloser", "net_to_closer", "externalPayable", "external_payable",
  "upline", "override",
];

/** Documents a client receives. A new one added here is covered automatically. */
function clientDocs(): string[] {
  const dir = join(ROOT, "lib", "pdf");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^(invoice|quotation|quote)[\w-]*\.tsx?$/i.test(f) && !f.includes(".test."))
    .map((f) => join(dir, f));
}

describe("client-facing documents carry no internal money", () => {
  // Control first. If this reports nothing, every assertion below is vacuous.
  it("the scan finds the client documents (control)", () => {
    const found = clientDocs().map((f) => f.slice(ROOT.length + 1));
    expect(found.length, "no client document matched — the scan is pointed at nothing").toBeGreaterThan(0);
    expect(found.some((f) => f.includes("invoice"))).toBe(true);
  });

  it("no client document names a commission, override, MD cut or retained figure", () => {
    const offenders: string[] = [];
    for (const f of clientDocs()) {
      for (const [i, line] of readFileSync(f, "utf8").split("\n").entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // the comments explain the rule
        for (const term of FORBIDDEN) {
          if (new RegExp(`\\b${term}\\b`, "i").test(line)) {
            offenders.push(`${f.slice(ROOT.length + 1)}:${i + 1}  ${term}`);
          }
        }
      }
    }
    expect(
      offenders,
      "a client document must render only what the client pays; see the owner's ruling at the top of this file",
    ).toEqual([]);
  });

  // The structural half. Rendering from a whole row is how a field nobody
  // intended ends up drawn — the narrow type is the actual protection, and the
  // check above only catches a field someone named on purpose.
  it("each client document renders from a narrow named projection, not a whole row", () => {
    const missing: string[] = [];
    for (const f of clientDocs()) {
      const src = readFileSync(f, "utf8");
      const hasNarrowType = /^type\s+Line\s*=\s*\{/m.test(src) || /^type\s+\w*Line\w*\s*=\s*\{/m.test(src);
      if (!hasNarrowType) missing.push(f.slice(ROOT.length + 1));
    }
    expect(missing, "declare an explicit line type listing exactly the client-visible fields").toEqual([]);
  });

  // A Prisma payload type pulls EVERY column of a row into the template's
  // reach, which defeats the narrow-projection rule above even if today's
  // markup happens not to draw them.
  it("no client document types itself from a whole Prisma row", () => {
    const offenders: string[] = [];
    for (const f of clientDocs()) {
      const src = readFileSync(f, "utf8");
      if (/GetPayload|Prisma\.(SalesSubmission|SalesTransaction|SaleLineItem|Product)\b/.test(src)) {
        offenders.push(f.slice(ROOT.length + 1));
      }
    }
    expect(offenders, "map to a narrow local type before the template sees it").toEqual([]);
  });
});
