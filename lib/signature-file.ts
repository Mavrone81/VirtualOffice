// Turns the PNG data URL a SignaturePad emits into a File, so a drawn
// signature goes through the exact same upload path (and the same size and
// magic-byte checks) as a picked PNG file. Returns null for anything that is
// not a base64 PNG data URL. Client-safe: uses atob, not Buffer.
export function signatureDataUrlToFile(dataUrl: string): File | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return null;
  let bin: string;
  try {
    bin = atob(m[1]);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length === 0) return null;
  return new File([bytes], "signature.png", { type: "image/png" });
}
