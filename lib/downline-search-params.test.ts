// Same structural guard as lib/team-search-params.test.ts: the key must live
// in a plain module so Server Components get the real string. vitest cannot
// reproduce the RSC transform, so this checks the precondition (no "use
// client") for both the module and every server-side importer path.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DOWNLINE_FILTER_KEY, DOWNLINE_DIRECT, parseDownlineParam, resolveDownlineFilter } from "./downline-search-params";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, "..", rel), "utf8");

describe("downline search params module", () => {
  it("has no \"use client\" directive and exports real strings", () => {
    expect(read("lib/downline-search-params.ts")).not.toMatch(/^\s*["']use client["']/m);
    expect(typeof DOWNLINE_FILTER_KEY).toBe("string");
    expect(DOWNLINE_FILTER_KEY).toBe("downline");
  });

  it("the client select does not re-export the key (server code must import the plain module)", () => {
    const src = read("components/transactions/downline-filter.tsx");
    expect(src).toMatch(/^"use client"/);
    expect(src).not.toMatch(/export\s+(const|\{)[^;]*DOWNLINE_FILTER_KEY/);
  });

  it("all three transaction pages import the key from the plain module", () => {
    for (const p of ["page", "received/page", "receivable/page"]) {
      expect(read(`app/portal/transactions/${p}.tsx`)).toContain('from "@/lib/downline-search-params"');
    }
  });
});

describe("parseDownlineParam", () => {
  it("accepts direct and a uuid; everything else is null", () => {
    expect(parseDownlineParam(DOWNLINE_DIRECT)).toEqual({ kind: "direct" });
    expect(parseDownlineParam("00000000-0000-4000-8000-00000000000A")).toEqual({ kind: "one", id: "00000000-0000-4000-8000-00000000000a" });
    for (const bad of [undefined, "", "x", ["direct"], "ind:00000000-0000-4000-8000-00000000000a"]) {
      expect(parseDownlineParam(bad as never)).toBeNull();
    }
  });
});

describe("resolveDownlineFilter (3 ids examined: me, direct, other)", () => {
  const me = "00000000-0000-4000-8000-00000000000a";
  const d = "00000000-0000-4000-8000-00000000000b";
  const other = "00000000-0000-4000-8000-00000000000d";
  it("direct = me + direct recruits, intersected with scope", () => {
    expect(resolveDownlineFilter(me, { kind: "direct" }, [d], null)?.sort()).toEqual([me, d].sort());
    expect(resolveDownlineFilter(me, { kind: "direct" }, [d], [me])).toEqual([me]);
  });
  it("a foreign id resolves to null (no filter), never to that id", () => {
    expect(resolveDownlineFilter(me, { kind: "one", id: other }, [d], null)).toBeNull();
  });
  it("no viewer id means no filter", () => {
    expect(resolveDownlineFilter(null, { kind: "direct" }, [d], null)).toBeNull();
  });
});
