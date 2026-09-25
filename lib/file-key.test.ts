import { describe, it, expect } from "vitest";
import { fileKeyFromSegments } from "./file-key";

describe("fileKeyFromSegments", () => {
  it("joins well-formed segments", () => {
    expect(fileKeyFromSegments(["associates", "971a6411-f402-487c-8514-fe1c2bf38dcd", "photo.jpg"]))
      .toBe("associates/971a6411-f402-487c-8514-fe1c2bf38dcd/photo.jpg");
    expect(fileKeyFromSegments(["documents", "x", "My_File-v2.pdf"])).toBe("documents/x/My_File-v2.pdf");
  });

  it.each([
    [[]], [undefined], [["a", ""]], [["a", "."]], [["a", ".."]],
    [["a", "../b"]], [["a", "..\\b"]], [["a", "%2e%2e"]], [["a", "b%2Fc"]],
    [["a", "b\u0000"]], [["a", "b c"]], [["a", "‥"]],
  ])("rejects %j", (segs) => {
    expect(fileKeyFromSegments(segs as string[] | undefined)).toBeNull();
  });
});
