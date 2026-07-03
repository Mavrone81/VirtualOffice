import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OnboardingStage, SubmissionStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/rbac";
import { initialsOf } from "@/lib/utils";
import { AppShell } from "@/components/shell/app-shell";

// Authed, per-request data — never prerender at build.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdminRole(session.user.role)) redirect("/portal/dashboard");

  const [recruit, verify] = await Promise.all([
    prisma.candidate.count({
      where: { onboardingStage: { in: [OnboardingStage.FormSubmitted, OnboardingStage.SignedPendingApproval] } },
    }),
    prisma.salesSubmission.count({ where: { status: SubmissionStatus.Submitted } }),
  ]);

  const tRoles = await getTranslations("roles");
  const name = session.user.name ?? tRoles(session.user.role);
  const user = {
    name,
    roleLabel: tRoles(session.user.role),
    initials: initialsOf(name),
  };

  return (
    <AppShell area="admin" user={user} badges={{ recruit, verify }}>
      {children}
    </AppShell>
  );
}
