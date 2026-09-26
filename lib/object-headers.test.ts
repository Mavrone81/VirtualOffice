import { describe, it, expect, vi } from "vitest";

vi.mock("./env", () => ({ env: { STORAGE_DIR: "/tmp/unused" } }));
import { objectResponseHeaders } from "./storage";

describe("objectResponseHeaders (SEC-11)", () => {
  it("serves images and PDF inline, always with nosniff", () => {
    for (const k of ["a/b/photo.jpg", "a/b/x.png", "a/b/doc.pdf"]) {
      const h = objectResponseHeaders(k, { cacheControl: "private, max-age=60" });
      expect(h["Content-Disposition"]).toMatch(/^inline;/);
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
      expect(h["Cache-Control"]).toBe("private, max-age=60");
    }
  });

  it("forces anything else to download as octet-stream", () => {
    for (const k of ["a/b/handbook.docx", "a/b/page.html", "a/b/logo.svg", "a/b/noext"]) {
      const h = objectResponseHeaders(k, { cacheControl: "no-store" });
      expect(h["Content-Type"]).toBe("application/octet-stream");
      expect(h["Content-Disposition"]).toMatch(/^attachment;/);
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
    }
  });

  it("sanitises the filename so it cannot break the header", () => {
    const h = objectResponseHeaders("a/b/x.pdf", { filename: 'signed-INV"1\r\nX: y.pdf', cacheControl: "no-store" });
    expect(h["Content-Disposition"]).toBe('inline; filename="signed-INV_1__X__y.pdf"');
  });
});
