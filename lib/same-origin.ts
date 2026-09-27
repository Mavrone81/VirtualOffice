/**
 * CSRF guard for cookie-authenticated POST route handlers (U1).
 *
 * Server actions get Next's built-in Origin check; plain route handlers don't. This
 * applies the same rule Next uses for server actions: the request's Origin host must
 * equal the host the request was served for (`x-forwarded-host`, else `host`), so it
 * behaves identically behind the same reverse proxy. Fails closed: a missing or
 * unparseable Origin is rejected (browsers always send Origin on a POST).
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // includes the literal "null" Origin (sandboxed iframes, file://)
  }
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || req.headers.get("host");
  return Boolean(host) && originHost.toLowerCase() === host!.toLowerCase();
}
