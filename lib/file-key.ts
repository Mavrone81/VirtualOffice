// Validate the catch-all segments of /api/files/[...key] into a storage key.
//
// Next has already percent-decoded each segment exactly once. They must NOT be
// decoded again: a second decode turns `..%252F<id>` into `../<id>`, which walks
// out of the caller's own namespace AFTER the prefix check has passed (SEC-1).
//
// Every key the app writes is built from UUIDs and `[\w.-]` file names (see the
// `safeName` sanitisers and the key templates in server/**), so an allowlist is
// both safe and lossless: any segment outside it — `.`/`..`, an embedded `/` or
// `\`, a `%`, an empty segment — is rejected rather than "cleaned".
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function fileKeyFromSegments(segments: readonly string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null;
  for (const s of segments) {
    if (!SEGMENT.test(s) || s === "." || s === "..") return null;
  }
  return segments.join("/");
}
