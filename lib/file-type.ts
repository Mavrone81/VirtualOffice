// Magic-byte upload validation (Phase 1d §4.2). Never trust a browser-supplied
// MIME type for a security decision — sniff the actual leading bytes instead.
export function sniffFileType(b: Uint8Array): "png" | "jpeg" | "pdf" | null {
  if (b.length >= 4 && b[0]===0x89 && b[1]===0x50 && b[2]===0x4e && b[3]===0x47) return "png";
  if (b.length >= 3 && b[0]===0xff && b[1]===0xd8 && b[2]===0xff) return "jpeg";
  if (b.length >= 4 && b[0]===0x25 && b[1]===0x50 && b[2]===0x44 && b[3]===0x46) return "pdf";
  return null;
}
export function assertUpload(b: Uint8Array, allow: Array<"png"|"jpeg"|"pdf">): "png"|"jpeg"|"pdf" {
  const t = sniffFileType(b);
  if (!t || !allow.includes(t)) throw new Error("BAD_UPLOAD_TYPE");
  return t;
}

// Admin document/notice uploads (SEC-11): PDF, PNG/JPEG and Office files only,
// and the file-name extension must agree with the sniffed content — so a file
// can't be stored as one type and served as another. Office Open XML files are
// ZIP containers (PK\x03\x04); legacy .doc/.xls/.ppt are OLE compound files.
const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isOle = (b: Uint8Array) =>
  b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
  b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1;

export function assertDocumentUpload(b: Uint8Array, fileName: string): void {
  const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) ?? "";
  const t = sniffFileType(b);
  const ok =
    (t === "pdf" && ext === "pdf") ||
    (t === "png" && ext === "png") ||
    (t === "jpeg" && (ext === "jpg" || ext === "jpeg")) ||
    (isZip(b) && ["docx", "xlsx", "pptx"].includes(ext)) ||
    (isOle(b) && ["doc", "xls", "ppt"].includes(ext));
  if (!ok) throw new Error("BAD_UPLOAD_TYPE");
}
