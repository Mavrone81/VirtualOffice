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

/**
 * 🔴 Every PDF template is classified here, by WHO RECEIVES IT, with a reason.
 *
 * The first version of this file matched filenames `^(invoice|quotation|quote)`
 * and its own comment claimed a new client document was "covered automatically".
 * That was false: lib/pdf held seven templates and the scan read two. The
 * denominator came from three filenames I expected to find rather than from the
 * directory, which is the exact failure this project gates other people on.
 *
 * So the list is explicit, and the control below FAILS when a template appears
 * that nobody has classified. A new document is now covered automatically in the
 * only sense that means anything: it breaks the build until someone says who
 * reads it.
 */
type Audience = "client" | "associate" | "counterparty";
/** `shape` matters because the two structural checks below only make sense for a
 *  document built from LINE ITEMS. A contract is prose with filled blanks: there
 *  is no line type to narrow, and demanding one would be a check that is merely
 *  loud rather than true. The forbidden-term scan applies to every client doc. */
const AUDIENCE: Record<string, { who: Audience; shape: "lines" | "prose"; why: string }> = {
  "invoice.tsx":            { shape: "lines", who: "client",       why: "the bill the purchasing client receives" },
  "quotation.tsx":          { shape: "lines", who: "client",       why: "what the client is quoted before they buy" },
  "sales-agreement.tsx":    { shape: "prose", who: "client",       why: "signed by the purchaser; app/agreements/[id]/pdf" },
  "ashes-agreement.tsx":    { shape: "prose", who: "client",       why: "signed by the applicant on the associate's device" },
  // Internal money is the POINT of these two — they are how an associate is paid.
  "statement.tsx":          { shape: "lines", who: "associate",    why: "the associate's own payout statement; app/payouts/[id]/statement" },
  "voucher.tsx":            { shape: "lines", who: "associate",    why: "PAYMENT VOUCHER · Commission · Associate; portal/transactions/[id]/voucher" },
  // A counterparty's own fee, in their own contract, is theirs to see.
  "referral-agreement.tsx": { shape: "prose", who: "counterparty", why: "the referral partner signs it; the commission named is their own" },
};

function templates(): string[] {
  const dir = join(ROOT, "lib", "pdf");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.tsx$/.test(f) && !f.includes(".test."));
}
const clientDocs = (): string[] =>
  templates().filter((f) => AUDIENCE[f]?.who === "client").map((f) => join(ROOT, "lib", "pdf", f));
/** Client documents rendered from line items — the only ones a narrow projection applies to. */
const clientLineDocs = (): string[] =>
  templates().filter((f) => AUDIENCE[f]?.who === "client" && AUDIENCE[f].shape === "lines")
             .map((f) => join(ROOT, "lib", "pdf", f));

describe("client-facing documents carry no internal money", () => {
  // Control first. If this reports nothing, every assertion below is vacuous.
  it("the scan finds the client documents (control)", () => {
    const found = clientDocs().map((f) => f.slice(ROOT.length + 1));
    expect(found.length, "no client document matched — the scan is pointed at nothing").toBeGreaterThanOrEqual(4);
    for (const must of ["invoice.tsx", "quotation.tsx", "sales-agreement.tsx", "ashes-agreement.tsx"]) {
      expect(found.some((f) => f.endsWith(must)), `${must} is client-facing and must be scanned`).toBe(true);
    }
  });

  // The denominator comes from the directory, not from expected filenames. A
  // template nobody has classified fails HERE rather than being silently skipped.
  it("every PDF template is classified by audience", () => {
    const unclassified = templates().filter((f) => !AUDIENCE[f]);
    expect(
      unclassified,
      "classify it in AUDIENCE with who receives it and why — a client document added without this would go unscanned",
    ).toEqual([]);
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
    for (const f of clientLineDocs()) {
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
