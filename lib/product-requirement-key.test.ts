import { describe, it, expect } from "vitest";
import { generateRequirementKey } from "./product-requirement-key";

describe("generateRequirementKey", () => {
  it("slugifies a plain English label", () => {
    expect(generateRequirementKey("Signed Contract", [])).toBe("signed_contract");
  });

  it("strips punctuation and collapses whitespace", () => {
    expect(generateRequirementKey("Payment Proof (Bank Transfer)!!", [])).toBe("payment_proof_bank_transfer");
  });

  it("dedupes against the product's existing keys with a numeric suffix", () => {
    expect(generateRequirementKey("Signed Contract", ["signed_contract"])).toBe("signed_contract_2");
    expect(generateRequirementKey("Signed Contract", ["signed_contract", "signed_contract_2"])).toBe("signed_contract_3");
  });

  it("falls back to a safe default when the label has nothing sluggable (e.g. all non-Latin)", () => {
    expect(generateRequirementKey("合同", [])).toBe("requirement");
    // A second all-non-Latin label on the same product still dedupes correctly.
    expect(generateRequirementKey("发票", ["requirement"])).toBe("requirement_2");
  });

  it("is unaffected by other products' keys — only the given product's existing keys matter", () => {
    expect(generateRequirementKey("Signed Contract", ["some_other_products_key"])).toBe("signed_contract");
  });
});
