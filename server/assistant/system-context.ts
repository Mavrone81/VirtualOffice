import { SubmissionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatSGD } from "@/lib/money";

/**
 * A compact, READ-ONLY snapshot of the portal for the admin AI assistant
 * (23-Jul chat bubble). Aggregates only — no bank details or other decrypted
 * PII — so the model can answer "how many sales are awaiting approval", "which
 * teams exist", "what's outstanding", etc. Admin-gated at the route; this never
 * runs for non-admins. Kept small on purpose to bound token cost.
 */
export async function buildSystemContext(now: Date): Promise<string> {
  const [
    companies,
    assocByStatus,
    teams,
    submitted,
    quotationOpen,
    closedTxns,
    eligibility,
    invoices,
    recentTxns,
  ] = await Promise.all([
    prisma.company.findMany({ select: { name: true, active: true }, orderBy: { name: "asc" } }),
    prisma.associate.groupBy({ by: ["associateStatus"], _count: { _all: true } }),
    prisma.team.findMany({ where: { active: true }, select: { name: true, directorId: true, _count: { select: { members: true } } }, orderBy: { name: "asc" } }),
    prisma.salesSubmission.count({ where: { status: SubmissionStatus.Submitted } }),
    prisma.salesSubmission.count({ where: { status: SubmissionStatus.QuotationApproved, closedAt: null } }),
    prisma.salesTransaction.count(),
    prisma.salesTransaction.groupBy({ by: ["commissionEligibility"], _count: { _all: true } }),
    prisma.invoice.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
    prisma.salesTransaction.findMany({
      orderBy: { verifiedAt: "desc" }, take: 5,
      select: { transactionCode: true, clientName: true, saleAmount: true, salesDate: true, commissionEligibility: true },
    }),
  ]);

  const dirIds = teams.map((t) => t.directorId).filter((x): x is string => !!x);
  const dirs = dirIds.length ? await prisma.associate.findMany({ where: { id: { in: dirIds } }, select: { id: true, fullName: true } }) : [];
  const dirName = new Map(dirs.map((d) => [d.id, d.fullName]));

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`Snapshot date: ${iso(now)}`);
  lines.push(`Companies (${companies.length}): ${companies.map((c) => c.name + (c.active ? "" : " [inactive]")).join(", ") || "none"}`);
  lines.push(`Associates by status: ${assocByStatus.map((a) => `${a.associateStatus} ${a._count._all}`).join(", ") || "none"}`);
  lines.push(`Teams (${teams.length}): ${teams.map((t) => `${t.name} — director ${t.directorId ? dirName.get(t.directorId) ?? "?" : "none"}, ${t._count.members} member(s)`).join("; ") || "none"}`);
  lines.push(`Sales pipeline: ${submitted} awaiting quotation approval, ${quotationOpen} approved but not yet closed, ${closedTxns} closed (transactions).`);
  lines.push(`Commission eligibility of closed sales: ${eligibility.map((e) => `${e.commissionEligibility} ${e._count._all}`).join(", ") || "none"}`);
  lines.push(`Invoices: ${invoices.map((i) => `${i.status} ${i._count._all} (${formatSGD(i._sum.amount ?? 0)})`).join(", ") || "none"}`);
  if (recentTxns.length) {
    lines.push("Recent closed sales:");
    for (const t of recentTxns) lines.push(`  - ${t.transactionCode}: ${t.clientName}, ${formatSGD(t.saleAmount)}, ${iso(t.salesDate)}, commission ${t.commissionEligibility}`);
  }
  return lines.join("\n");
}
