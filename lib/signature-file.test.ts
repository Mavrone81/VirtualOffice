import { describe, it, expect } from "vitest";
import { signatureDataUrlToFile } from "./signature-file";
import { assertUpload } from "./file-type";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 250, 251, 252]);
const dataUrl = (b: Uint8Array) => `data:image/png;base64,${Buffer.from(b).toString("base64")}`;

describe("signatureDataUrlToFile", () => {
  it("round-trips a PNG data URL to a png File with identical bytes", async () => {
    const f = signatureDataUrlToFile(dataUrl(PNG_BYTES));
    expect(f).not.toBeNull();
    expect(f!.type).toBe("image/png");
    expect(f!.size).toBe(PNG_BYTES.length);
    const out = new Uint8Array(await f!.arrayBuffer());
    expect(Array.from(out)).toEqual(Array.from(PNG_BYTES));
    // passes the same server-side check the upload path applies
    expect(assertUpload(out, ["png"])).toBe("png");
  });

  it("rejects non-PNG, malformed and empty data URLs", () => {
    expect(signatureDataUrlToFile("data:image/jpeg;base64,/9j/4AAQ")).toBeNull();
    expect(signatureDataUrlToFile("data:image/png;base64,")).toBeNull();
    expect(signatureDataUrlToFile("data:image/png;base64,@@@")).toBeNull();
    expect(signatureDataUrlToFile("not a data url")).toBeNull();
    expect(signatureDataUrlToFile("")).toBeNull();
  });
});
