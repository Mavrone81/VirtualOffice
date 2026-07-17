import { prisma } from "@/lib/db";
import { verify } from "@node-rs/argon2";

/**
 * Fresh-password re-authentication. Loads the user's stored hash and verifies
 * `password` against it (argon2). Used to gate money-leaving actions (bank-file
 * generation) behind a deliberate password re-entry — a session cookie alone is
 * not enough authority to emit a GIRO file.
 *
 * Returns false — never throws — on an empty password, a missing user, a user
 * with no hash, or a verification failure, so callers get a plain boolean.
 */
export async function reauth(userId: string, password: string): Promise<boolean> {
  if (!password) return false;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!u?.passwordHash) return false;
  try {
    return await verify(u.passwordHash, password);
  } catch {
    return false;
  }
}
