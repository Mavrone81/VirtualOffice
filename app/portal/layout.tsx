import { redirect } from "next/navigation";
import { SubmissionStatus, SubmissionFlow } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
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

  // A-17 live-path finding: an associate's Legacy sale can sit at
  // QuotationApproved indefinitely — Legacy rows never reach a later status
  // on close-out (no Verified step for this flow), so status alone can't
  // tell "still needs closing" from "closed months ago". The only
  // authoritative test is whether a SalesTransaction exists yet (closeSale
  // mints one); `closedAt` does NOT carry this meaning in production despite
  // an earlier schema comment claiming it does — a production read-only
  // check found closedAt NULL on every Legacy/QuotationApproved row, booked
  // or not. Computed live, per render, never cached: a stale "none pending"
  // during someone's mid-close-out would be worse than the cost of one extra
  // COUNT per portal page load for an associate with none.
  let hasInFlightLegacyQuotation = false;
  if (session.user.associateId) {
    const inFlight = await prisma.salesSubmission.count({
      where: {
        closingAssociateId: session.user.associateId,
        flow: SubmissionFlow.Legacy,
        status: SubmissionStatus.QuotationApproved,
        transaction: null,
      },
    });
    hasInFlightLegacyQuotation = inFlight > 0;
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
    <AppShell
      area="portal"
      user={user}
      badges={{ notices: unreadNotices, splitApprovals }}
      marketingLibraryEnabled={env.MARKETING_LIBRARY_ENABLED}
      hasInFlightLegacyQuotation={hasInFlightLegacyQuotation}
      alerts={alerts}
      period={currentPeriod(locale)}
    >
      {children}
    </AppShell>
  );
}
