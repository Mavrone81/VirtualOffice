import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { FORCE_RESET_PATH, shouldForceReset } from "./lib/force-reset";

const { auth } = NextAuth(authConfig);

// Route protection. Public: /login and the tokenised /onboard/[token] flow.
export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const pathname = nextUrl.pathname;
  const isLogin = pathname === "/login";
  const isPublic =
    isLogin ||
    pathname.startsWith("/onboard") ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/reset-password");

  if (!isLoggedIn && !isPublic) {
    const url = new URL("/login", nextUrl);
    url.searchParams.set("from", pathname);
    return Response.redirect(url);
  }

  // A provisioned/admin-reset login must set a new password before anything else.
  if (shouldForceReset({ isLoggedIn, mustReset: !!req.auth?.user?.mustResetPassword, pathname })) {
    return Response.redirect(new URL(FORCE_RESET_PATH, nextUrl));
  }

  if (isLoggedIn && isLogin) {
    return Response.redirect(new URL("/", nextUrl));
  }
});

export const config = {
  // Run on everything except API routes, Next internals, static assets, the
  // public name-card brand art (logo/flowers/back — needed by the card
  // export), and self-hosted webfonts (public/fonts/** — same reasoning as
  // namecard: a @font-face url() is a same-origin GET like any other asset
  // request, not a page view, and gating it behind auth means an anonymous
  // render of anything using that font silently falls back to a different
  // typeface instead of failing loudly. C-1 added Alex Brush without this
  // exclusion; nothing currently renders it
  // unauthenticated, so it was latent rather than live, but the next
  // render path that does would have broken silently — hardening this now
  // closes that before it's needed.
  //
  // Pre-existing defect fixed in passing, same line, zero exploitable routes
  // today (every app/* route checked): the exclusions above were a bare
  // literal PREFIX match, not anchored to a path segment, so "/namecardish"
  // or "/fonts-admin" would have been wrongly excluded too, and
  // "favicon.ico" had an unescaped "." matching any character. Segment-
  // anchored via (?:/|\?|$) and the dot escaped below -- which tightens all
  // FIVE pre-existing exclusions (api, _next/static, _next/image,
  // favicon.ico, namecard), not just the new "fonts" one: a future route
  // actually named e.g. /api-docs or /namecards now goes through middleware
  // where it previously wouldn't have. Fail-safe direction (more gated, not
  // less), and nothing today is named that way, but worth knowing before
  // naming a route.
  //
  // \? in the boundary: harmless, and here deliberately rather than removed
  // once checked. Confirmed from Next's own source
  // (node_modules/next/dist/shared/lib/router/utils/middleware-route-matcher.js):
  // `new RegExp(matcher.regexp).exec(pathname)` — query IS passed into that
  // matcher function (it's used for `has`/`missing` conditions elsewhere),
  // but never reaches THE REGEXP itself, which only ever sees pathname. So
  // /_next/image?url=…'s pathname is plain "/_next/image" and already
  // matched the "/|$" boundary via "$" without this. No live defect
  // existed; \? just makes the pattern correct under a stricter (and
  // currently false) assumption too, at zero cost — and if a future edit
  // adds a `has`/`missing` clause to this matcher, query DOES become
  // relevant there, just still not to this regexp. Do not read \?'s
  // presence as evidence the bare boundary was broken.
  matcher: ["/((?!(?:api|_next/static|_next/image|favicon\\.ico|namecard|fonts)(?:/|\\?|$)).*)"],
};
