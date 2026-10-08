import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { adminNav } from "./nav";

/**
 * An admin submitted a sale and could not see it (owner, 2026-10-08).
 *
 * Two independent faults, each invisible on its own:
 *
 * 1. `/admin/sales` — the admin's own sales list — existed since item 9 and
 *    NOTHING linked to it. A page with no route into it is the same as no page,
 *    and nothing fails when one exists.
 * 2. Every link inside the shared sale pages was hardcoded to `/portal/...`,
 *    and `app/portal/layout.tsx` redirects any admin out of `/portal`. So the
 *    links rendered, looked right, and bounced to the admin dashboard on click.
 *    Both were written down in code comments as known rough edges and left.
 *
 * The denominator comes from the filesystem, so an admin sale route added later
 * is covered without anyone remembering this file exists.
 */
const ROOT = join(__dirname, "..");
const ADMIN_SALES = join(ROOT, "app/admin/sales");

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

// adminNav is NavGroup[] — groups hold `items`, items may hold `children`.
const flatten = (nodes: readonly unknown[]): { href?: string }[] =>
  nodes.flatMap((n) => {
    const x = n as { href?: string; items?: readonly unknown[]; children?: readonly unknown[] };
    if (x.items) return flatten(x.items);
    if (x.children) return [x, ...flatten(x.children)];
    return [x];
  });

describe("an admin can reach, and open, their own sales", () => {
  it("the admin nav links to /admin/sales — fault 1", () => {
    const hrefs = flatten(adminNav).map((n) => n.href);
    expect(hrefs).toContain("/admin/sales");
  });

  // Fault 2. A /portal href inside an admin-rendered page is a bounce, not a
  // link: the portal layout redirects admins out before the page renders.
  it("no admin sale page links into /portal", () => {
    const offenders: string[] = [];
    for (const f of pages(ADMIN_SALES).concat(join(ROOT, "app/admin/agreements/page.tsx"))) {
      if (!existsSync(f)) continue;
      const src = readFileSync(f, "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        if (/^\s*(\/\/|\*)/.test(line)) continue; // the comments explain the rule
        if (/["'`]\/portal\//.test(line)) offenders.push(`${f.slice(ROOT.length + 1)}:${i + 1}`);
      }
    }
    expect(offenders, "an admin clicking a /portal link is redirected to /admin/dashboard").toEqual([]);
  });

  // Every destination the detail page offers must exist as an admin route, or
  // the button 404s instead of bouncing — a different failure, equally dead.
  it("every admin sale route the detail page links to exists", () => {
    for (const r of ["page.tsx", "[id]/page.tsx", "[id]/edit/page.tsx", "[id]/agreement/page.tsx"]) {
      expect(existsSync(join(ADMIN_SALES, r)), `missing app/admin/sales/${r}`).toBe(true);
    }
  });

  it("the shared pages take a base path rather than hardcoding one", () => {
    for (const f of ["app/portal/sales/page.tsx", "app/portal/sales/[id]/page.tsx", "app/portal/sales/[id]/edit/page.tsx"]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).toContain("basePath");
    }
  });

  // Control: proves the scan reads real files. Without it, a wrong ROOT makes
  // the offender check pass by finding nothing at all.
  it("control — the scan finds admin sale pages", () => {
    expect(pages(ADMIN_SALES).length).toBeGreaterThanOrEqual(4);
  });
});
