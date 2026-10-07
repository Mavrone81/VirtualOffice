import { prisma } from "@/lib/db";

/**
 * The associate record behind the signed-in user's OWN name card.
 *
 * Why this is a function and not two copies of the same three lines: the card
 * page and the .vcf route must agree, or a client saves one title and reads
 * another off the card in their hand. The route already carried a comment
 * promising it used "the same source as the card itself" — a promise that only
 * held for as long as somebody remembered to edit both files. This is the
 * third time a name-card fix has landed on one surface and missed another
 * (#145 missed the admin page, #155 fixed it), so the shared thing is now
 * shared rather than described as shared.
 *
 * Resolution order, and why there are two steps: `session.user.associateId` is
 * a LINK, and it can simply be absent — an admin login created before, or
 * apart from, its associate record carries no associateId even though the
 * person has a full profile. When that happens every field on the card falls
 * back to session/role data, which is how a card came to print the role label
 * "Product Owner" where a designation belongs (owner, 2026-10-07). So the link
 * is tried first, and the login email second: it is the key the rest of the
 * app provisions logins on, and it is unique on associates. A login with no
 * associate record at all still resolves to null, and the callers keep their
 * own fallbacks for that case.
 */
export async function ownAssociate(params: { associateId?: string | null; email?: string | null }) {
  if (params.associateId) {
    const linked = await prisma.associate.findUnique({ where: { id: params.associateId } });
    if (linked) return linked;
  }
  if (params.email) return prisma.associate.findFirst({ where: { email: params.email } });
  return null;
}
