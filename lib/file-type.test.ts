import { describe, it, expect } from "vitest";
import { sniffFileType, assertUpload } from "./file-type";
const PNG = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const JPEG = new Uint8Array([0xff,0xd8,0xff,0xe0]);
const PDF = new Uint8Array([0x25,0x50,0x44,0x46,0x2d]);
describe("sniffFileType", () => {
  it("detects png/jpeg/pdf and rejects junk", () => {
    expect(sniffFileType(PNG)).toBe("png");
    expect(sniffFileType(JPEG)).toBe("jpeg");
    expect(sniffFileType(PDF)).toBe("pdf");
    expect(sniffFileType(new Uint8Array([1,2,3,4]))).toBe(null);
  });
  it("assertUpload throws when type not allowed", () => {
    expect(assertUpload(PNG, ["png","jpeg"])).toBe("png");
    expect(() => assertUpload(PDF, ["png","jpeg"])).toThrow("BAD_UPLOAD_TYPE");
  });
});
