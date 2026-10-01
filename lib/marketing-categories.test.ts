import { describe, it, expect } from "vitest";
import { MarketingCategory } from "@prisma/client";
import { categoryFromSlug, slugForCategory } from "./marketing-categories";

describe("marketing category <-> slug mapping", () => {
  it("round-trips every category through slugForCategory -> categoryFromSlug", () => {
    for (const category of Object.values(MarketingCategory)) {
      expect(categoryFromSlug(slugForCategory(category))).toBe(category);
    }
  });

  it("rejects an unknown slug", () => {
    expect(categoryFromSlug("not-a-real-category")).toBeNull();
  });
});
