import { describe, it, expect } from "vitest";
import { buildVCard } from "./vcard";

// B-8 architect review, Low note 1: esc() escaped \n but not a bare \r,
// which could break a .vcf line. Fixed to fold \n, \r\n and bare \r alike.

describe("buildVCard — field escaping", () => {
  it("escapes commas, semicolons and backslashes", () => {
    const vcf = buildVCard({ fullName: "Tan, Jane; \\Test", title: null });
    expect(vcf).toContain("FN:Tan\\, Jane\\; \\\\Test");
  });

  it("folds a \\n into the vCard line-continuation escape", () => {
    const vcf = buildVCard({ fullName: "Jane", title: "Line1\nLine2" });
    expect(vcf).toContain("TITLE:Line1\\nLine2");
    expect(vcf).not.toMatch(/TITLE:Line1\nLine2/);
  });

  it("folds a \\r\\n into the same escape", () => {
    const vcf = buildVCard({ fullName: "Jane", title: "Line1\r\nLine2" });
    expect(vcf).toContain("TITLE:Line1\\nLine2");
  });

  it("folds a bare \\r (previously unescaped) too", () => {
    const vcf = buildVCard({ fullName: "Jane", title: "Line1\rLine2" });
    expect(vcf).toContain("TITLE:Line1\\nLine2");
    expect(vcf).not.toContain("Line1\rLine2");
  });
});
