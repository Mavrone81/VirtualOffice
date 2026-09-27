import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { findDuplicateKeys } from "./check-duplicate-keys";

describe("findDuplicateKeys", () => {
  it("flags a repeated key within the same object", () => {
    expect(findDuplicateKeys('{"a": 1, "b": 2, "a": 3}')).toEqual(["a"]);
  });

  it("does not flag the same key name in two different nested objects", () => {
    expect(findDuplicateKeys('{"x": {"title": "a"}, "y": {"title": "b"}}')).toEqual([]);
  });

  it("ignores string VALUES that happen to match a key name", () => {
    expect(findDuplicateKeys('{"a": "a", "b": "a"}')).toEqual([]);
  });

  it("handles escaped quotes inside strings without losing its place", () => {
    expect(findDuplicateKeys('{"a": "she said \\"hi\\"", "b": 2}')).toEqual([]);
    expect(findDuplicateKeys('{"a": 1, "a": "x \\" y"}')).toEqual(["a"]);
  });
});

// The actual guard: en.json and zh-CN.json must have no duplicate key within
// any single object — a duplicate silently shadows the first entry (as
// errors.recomputeBusy did: R-4's vague wording won over A-0's "payment was
// NOT recorded", because it happened to come later in the file).
describe("messages/en.json and messages/zh-CN.json have no duplicate keys", () => {
  it.each(["en.json", "zh-CN.json"])("%s", (file) => {
    const text = readFileSync(join(process.cwd(), "messages", file), "utf8");
    expect(findDuplicateKeys(text)).toEqual([]);
  });
});
