import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { OnboardingStage, SubmissionStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { initialsOf, currentPeriod } from "@/lib/utils";
import { AppShell } from "@/components/shell/app-shell";

// Authed, per-request data — never prerender at build.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdminRole(session.user.role)) redirect("/portal/dashboard");

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const [recruit, quotations] = await Promise.all([
    prisma.candidate.count({
      where: { onboardingStage: { in: [OnboardingStage.FormSubmitted, OnboardingStage.SignedPendingApproval] } },
    }),
    // Awaiting quotation approval = split-approved (Director or 3-day auto).
    prisma.salesSubmission.count({
      where: { status: SubmissionStatus.Submitted, OR: [{ sdApprovedAt: { not: null } }, { createdAt: { lte: threeDaysAgo } }] },
    }),
  ]);

  const tRoles = await getTranslations("roles");
  const locale = await getLocale();
  const name = session.user.name ?? tRoles(session.user.role);
  const user = {
    name,
    roleLabel: tRoles(session.user.role),
    initials: initialsOf(name),
    // Without this the sidebar's role filter hides every Admin-only nav item
    // (Teams, Products, Audit Log, UAT) — they'd be reachable only by URL.
    role: session.user.role,
  };

  const alerts = [
    { labelKey: "recruitment", count: recruit, href: "/admin/recruitment" },
    { labelKey: "quotations", count: quotations, href: "/admin/quotations" },
  ];

  return (
    <AppShell area="admin" user={user} badges={{ recruit, quotations }} alerts={alerts} period={currentPeriod(locale)}>
      {children}
    </AppShell>
  );
}
