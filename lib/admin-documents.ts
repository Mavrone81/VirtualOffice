import { prisma } from "@/lib/db";

// The admin Documents library: every ordinary document plus the CURRENT upload
// per template category. Retired template versions (retiredAt set, superseded
// by a newer upload — B-5) are history with no admin UI, so they are excluded
// here; without this filter every template replace would add a stale row.
export function listAdminDocuments() {
  return prisma.document.findMany({
    where: { retiredAt: null },
    orderBy: { createdAt: "desc" },
    include: { assignedAssociate: { select: { associateCode: true } } },
  });
}
