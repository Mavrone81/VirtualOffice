import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_INSTALMENT_MONTHS, saleSchema, productPricingSchema } from "./schemas";

/**
 * The owner ruled the maximum instalment term at 72 months on 2026-10-09.
 *
 * Before that ruling the two sides of this disagreed: the PRODUCT side allowed
 * 1200 months and the SALE side allowed 24. That gap is not cosmetic — it means
 * a 36-month plan could be offered on a product, shown to a client, and then
 * refused at the point of sale. The bug is the DIVERGENCE, so these tests are
 * written against the divergence and not against the number.
 *
 * Deliberately not asserting `=== 72` in most of them: a test that hardcodes the
 * policy number has to be edited whenever the policy changes, which makes it an
 * obstacle rather than a guard. What must never change is that both paths agree
 * and that the database enforces the same thing as the code.
 */
const ROOT = join(__dirname, "..");

describe("the instalment term cap is one policy, not three", () => {
  /** Does either schema object to the TERM specifically?
   *
   *  Deliberately indifferent to every other field. Both schemas require things
   *  this test has no business knowing about, and `instalmentPlanShape` is mid-
   *  change — `monthlyAmount` is required on main today and is being removed by
   *  the derivation work. A fixture that had to satisfy the whole schema would
   *  break on that landing and look like a cap regression. Asking only "is there
   *  an issue on this path" survives both states. */
  const productRejectsTerm = (m: number) =>
    (productPricingSchema.safeParse({ listedPrice: "1000.00", instalmentPlans: [{ months: m }] })
      .error?.issues ?? []).some((i) => i.path.includes("months"));

  const saleRejectsTerm = (m: number) =>
    (saleSchema.safeParse({ paymentPlan: "Installment", installmentCount: m })
      .error?.issues ?? []).some((i) => i.path.includes("installmentCount"));

  it("the product side and the sale side accept exactly the same maximum", () => {
    expect(productRejectsTerm(MAX_INSTALMENT_MONTHS), "product must accept the cap").toBe(false);
    expect(saleRejectsTerm(MAX_INSTALMENT_MONTHS), "sale must accept the cap").toBe(false);
    expect(productRejectsTerm(MAX_INSTALMENT_MONTHS + 1), "product must refuse one past it").toBe(true);
    expect(saleRejectsTerm(MAX_INSTALMENT_MONTHS + 1), "sale must refuse one past it").toBe(true);
  });

  // Control. Without this, a schema that rejected EVERY term would satisfy the
  // "refuses one past the cap" half and look like a pass.
  it("control — an ordinary 12-month term is objected to by neither", () => {
    expect(productRejectsTerm(12)).toBe(false);
    expect(saleRejectsTerm(12)).toBe(false);
  });

  // The constant is the single source. A literal re-appearing in either path is
  // how they drifted to 1200 and 24 in the first place.
  it("neither path carries its own hardcoded bound", () => {
    const src = readFileSync(join(ROOT, "lib", "schemas.ts"), "utf8");
    const offenders: string[] = [];
    for (const [i, line] of src.split("\n").entries()) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;              // comments explain the history
      if (/\.max\(\s*\d+\s*\)/.test(line) && /months|installmentCount/i.test(line)) {
        offenders.push(`lib/schemas.ts:${i + 1}  ${line.trim()}`);
      }
    }
    expect(offenders, "use MAX_INSTALMENT_MONTHS, not a literal").toEqual([]);
  });

  // The database must enforce it too: zod does not run for a raw write, a seed
  // script, or a server action nobody has written yet.
  it("the database enforces the same cap, in a migration", () => {
    const dir = join(ROOT, "prisma", "migrations", "20261010010000_instalment_term_policy_cap");
    const sql = readFileSync(join(dir, "migration.sql"), "utf8");
    expect(sql).toMatch(/CHECK\s*\(\s*"months"\s*<=\s*72\s*\)/);
    expect(sql, "must fail rather than silently skip if existing rows violate it").toMatch(/RAISE EXCEPTION/);
  });
});
