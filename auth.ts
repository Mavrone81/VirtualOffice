import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verify } from "@node-rs/argon2";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authConfig } from "./auth.config";

const creds = z.object({ email: z.string().min(1), password: z.string().min(1) });

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = creds.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
          include: { associate: true },
        });
        if (!user || !user.isActive) return null;
        const ok = await verify(user.passwordHash, password);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name:
            user.associate?.fullName ??
            (user.role === "Admin" ? "Product Owner" : user.role === "Accounts" ? "Accounts" : user.email),
          role: user.role,
          associateId: user.associateId ?? null,
          mustResetPassword: user.mustResetPassword,
        };
      },
    }),
  ],
});
