import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verify } from "@node-rs/argon2";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/rate-limit";
import { revalidateToken, type LiveUser } from "@/lib/session-refresh";
import { authConfig } from "./auth.config";

const creds = z.object({ email: z.string().min(1), password: z.string().min(1) });

async function loadLiveUser(userId: string): Promise<LiveUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true, associateId: true, mustResetPassword: true },
  });
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Node-runtime only (middleware keeps the edge-safe base callback): mint the
    // claims at sign-in, then re-check the user's live state on later calls so a
    // deactivated/demoted user loses access within REVALIDATE_MS (SEC-2).
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params);
      if (params.user) return { ...token, chk: Date.now() };
      return revalidateToken(token, loadLiveUser);
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        // Identifier = the submitted email, lowercased+trimmed (stable
        // credential key); "unknown" if missing/empty so malformed
        // submissions still land in a single bucket rather than bypassing
        // rate-limiting entirely.
        const id = String((raw as { email?: unknown } | null | undefined)?.email ?? "").toLowerCase().trim() || "unknown";
        if (!(await checkRateLimit(id, "login")).allowed) return null;

        const parsed = creds.safeParse(raw);
        if (!parsed.success) {
          await recordFailure(id, "login");
          return null;
        }
        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
          include: { associate: true },
        });
        if (!user || !user.isActive) {
          await recordFailure(id, "login");
          return null;
        }
        const ok = await verify(user.passwordHash, password);
        if (!ok) {
          await recordFailure(id, "login");
          return null;
        }
        await recordSuccess(id, "login");
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
