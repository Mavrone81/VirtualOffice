/** A minimal, magic-byte-valid fake PDF for tests exercising SEC-11 upload
 * checks (B-7's payment acknowledgement, uploadSignedInvoice, etc.) — never
 * used outside test files. */
export function fakePdfFile(name = "ack.pdf"): File {
  const bytes = new TextEncoder().encode("%PDF-1.4\n%fake test pdf\n");
  return new File([bytes], name, { type: "application/pdf" });
}
