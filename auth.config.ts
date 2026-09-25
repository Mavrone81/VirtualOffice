import type { NextAuthConfig } from "next-auth";

// Edge-safe base config (no Prisma / no native modules) — shared by middleware
// and the full server-side auth in auth.ts. The Credentials provider with the
// DB lookup lives in auth.ts (Node runtime only).
export const authConfig = {
  pages: { signIn: "/login" },
  // Explicit, shorter than the 30-day default (SEC-2). Shared with middleware,
  // which also re-issues the session cookie.
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.associateId = user.associateId;
        token.mustResetPassword = user.mustResetPassword;
        if (user.name) token.name = user.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role;
        session.user.associateId = token.associateId;
        session.user.mustResetPassword = token.mustResetPassword;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
