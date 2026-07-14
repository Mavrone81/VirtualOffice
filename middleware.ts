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
  // Run on everything except API routes, Next internals, static assets, and the
  // public name-card brand art (logo/flowers/back — needed by the card export).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|namecard).*)"],
};
