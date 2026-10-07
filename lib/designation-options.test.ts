import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Designation } from "@prisma/client";
import { DESIGNATION_OPTIONS, DESIGNATION_VALUES } from "./roles";
import { newAssociateSchema } from "./schemas";

/**
 * A designation that exists in the database but cannot be given to anybody.
 *
 * That is what shipped on 2026-10-07: ManagingDirector was added to the Prisma
 * enum, the migration applied cleanly, the column and the enum value were
 * verified present on production — and it still appeared in no form, because
 * the three designation dropdowns and the zod enum were four hand-written
 * copies of the list. Every check passed. None of them asked whether a human
 * could pick it.
 *
 * So the denominator here comes from Prisma's enum, never from a list written
 * in this file. Add a designation and these fail until it is actually usable.
 */
const FORMS = [
  "app/admin/associates/new/associate-form.tsx",
  "app/admin/associates/[id]/edit/edit-form.tsx",
  "app/admin/recruitment/new/invite-form.tsx",
];
const ROOT = join(__dirname, "..");
const messages = JSON.parse(readFileSync(join(ROOT, "messages/en.json"), "utf8"));
const zh = JSON.parse(readFileSync(join(ROOT, "messages/zh-CN.json"), "utf8"));

const lookup = (src: Record<string, unknown>, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], src);

describe("every designation is actually usable", () => {
  it("the shared option list covers the Prisma enum exactly", () => {
    expect([...DESIGNATION_OPTIONS.map((d) => d.value)].sort()).toEqual([...Object.values(Designation)].sort());
  });

  it("the input schema accepts every designation — a value the DB has but zod rejects is unusable", () => {
    const base = { fullName: "A B", designation: Designation.SalesAssociate, joinDate: "2026-01-01" };
    for (const d of Object.values(Designation)) {
      const r = newAssociateSchema.safeParse({ ...base, designation: d });
      // Other fields may fail; what must never happen is the DESIGNATION itself
      // being the thing rejected.
      const rejectedOnDesignation =
        !r.success && r.error.issues.some((i) => i.path.join(".") === "designation");
      expect(rejectedOnDesignation, `zod rejects designation ${d}`).toBe(false);
    }
  });

  it("every designation has a label in BOTH locales", () => {
    for (const { value, labelKey } of DESIGNATION_OPTIONS) {
      expect(lookup(messages.associates ?? messages, labelKey), `en label for ${value}`).toBeTruthy();
      expect(lookup(zh.associates ?? zh, labelKey), `zh label for ${value}`).toBeTruthy();
    }
  });

  // The structural half: no form may go back to hand-writing the list.
  it("no form hardcodes designation <option> values", () => {
    const offenders = FORMS.filter((f) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      return /<option value="(SalesAssociate|SalesAssistantManager|SalesManager|SalesDirector|ManagingDirector)"/.test(src);
    });
    expect(offenders, "render DESIGNATION_OPTIONS instead of writing <option> by hand").toEqual([]);
  });

  it("every form renders the shared list", () => {
    const missing = FORMS.filter((f) => !readFileSync(join(ROOT, f), "utf8").includes("DESIGNATION_OPTIONS"));
    expect(missing).toEqual([]);
  });

  // Control: proves the file reads above actually resolve. Without it, a wrong
  // ROOT would make both scans pass by finding nothing.
  it("control — the form files exist and are non-empty", () => {
    for (const f of FORMS) expect(statSync(join(ROOT, f)).size).toBeGreaterThan(100);
    expect(DESIGNATION_VALUES.length).toBeGreaterThan(1);
    expect(readdirSync(join(ROOT, "lib")).length).toBeGreaterThan(0);
  });
});
