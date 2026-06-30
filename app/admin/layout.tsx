import { redirect } from "next/navigation";
import { OnboardingStage, SubmissionStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole, roleLabel } from "@/lib/rbac";
import { initialsOf } from "@/lib/utils";
import { AppShell } from "@/components/shell/app-shell";

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

  const user = {
    name: session.user.name ?? "Product Owner",
    roleLabel: roleLabel[session.user.role],
    initials: initialsOf(session.user.name ?? "Product Owner"),
  };

  return (
    <AppShell area="admin" user={user} badges={{ recruit, verify }}>
      {children}
    </AppShell>
  );
}
