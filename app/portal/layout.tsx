import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { noticeAudienceWhere } from "@/lib/notices";
import { initialsOf } from "@/lib/utils";
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

  const user = {
    name,
    roleLabel: tRoles(session.user.role),
    initials: initialsOf(name),
    subtitle: assoc?.associateCode,
    role: session.user.role,
  };

  return (
    <AppShell area="portal" user={user} badges={{ notices: unreadNotices }}>
      {children}
    </AppShell>
  );
}
