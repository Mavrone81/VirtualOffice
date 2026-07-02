import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminRole, roleLabel } from "@/lib/rbac";
import { initialsOf } from "@/lib/utils";
import { AppShell } from "@/components/shell/app-shell";

// Authed, per-request data — never prerender at build.
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (isAdminRole(session.user.role)) redirect("/admin/dashboard");

  const assoc = session.user.associateId
    ? await prisma.associate.findUnique({ where: { id: session.user.associateId } })
    : null;
  const name = assoc?.fullName ?? session.user.name ?? "Associate";

  const user = {
    name,
    roleLabel: roleLabel[session.user.role],
    initials: initialsOf(name),
    subtitle: assoc?.associateCode,
    role: session.user.role,
  };

  return (
    <AppShell area="portal" user={user}>
      {children}
    </AppShell>
  );
}
