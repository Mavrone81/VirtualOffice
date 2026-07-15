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
