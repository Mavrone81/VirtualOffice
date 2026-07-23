import { redirect } from "next/navigation";
import { SubmissionStatus } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { noticeAudienceWhere } from "@/lib/notices";
import { initialsOf, currentPeriod } from "@/lib/utils";
import { AppShell } from "@/components/shell/app-shell";

// Authed, per-request data — never prerender at build.
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (isAdminRole(session.user.role)) redirect("/admin/dashboard");

  const tRoles = await getTranslations("roles");
  const assoc = session.user.associateId
    ? await prisma.associate.findUnique({ where: { id: session.user.associateId } })
    : null;
  const name = assoc?.fullName ?? session.user.name ?? tRoles(session.user.role);

  // Unread notices count for the sidebar badge.
  const relevant = await prisma.notice.findMany({
    where: noticeAudienceWhere(session.user.role, assoc?.teamName ?? null),
    select: { id: true },
  });
  const readCount = relevant.length
    ? await prisma.noticeRead.count({ where: { userId: session.user.id, noticeId: { in: relevant.map((n) => n.id) } } })
    : 0;
  const unreadNotices = relevant.length - readCount;

  // Pending split-approvals for a team Director (23-Jul, issue 2) — sidebar
  // badge. Counts still-open sales routed to this SD (splitDirectorId) awaiting
  // their approval.
  let splitApprovals = 0;
  if (session.user.role === "SalesDirector" && session.user.associateId) {
    splitApprovals = await prisma.salesSubmission.count({
      where: { status: SubmissionStatus.Submitted, sdApprovedAt: null, closedAt: null, splitDirectorId: session.user.associateId },
    });
  }

  const user = {
    name,
    roleLabel: tRoles(session.user.role),
    initials: initialsOf(name),
    subtitle: assoc?.associateCode,
    role: session.user.role,
  };

  const locale = await getLocale();
  const alerts = [{ labelKey: "notices", count: unreadNotices, href: "/portal/notices" }];

  return (
    <AppShell area="portal" user={user} badges={{ notices: unreadNotices, splitApprovals }} alerts={alerts} period={currentPeriod(locale)}>
      {children}
    </AppShell>
  );
}
