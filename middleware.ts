import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

// Route protection. Public: /login and the tokenised /onboard/[token] flow.
export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isLogin = nextUrl.pathname === "/login";
  const isPublic = isLogin || nextUrl.pathname.startsWith("/onboard");

  if (!isLoggedIn && !isPublic) {
    const url = new URL("/login", nextUrl);
    url.searchParams.set("from", nextUrl.pathname);
    return Response.redirect(url);
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
