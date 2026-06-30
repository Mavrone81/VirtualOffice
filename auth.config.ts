import type { NextAuthConfig } from "next-auth";

// Edge-safe base config (no Prisma / no native modules) — shared by middleware
// and the full server-side auth in auth.ts. The Credentials provider with the
// DB lookup lives in auth.ts (Node runtime only).
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.associateId = user.associateId;
        if (user.name) token.name = user.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role;
        session.user.associateId = token.associateId;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
