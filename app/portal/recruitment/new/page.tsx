import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canRecruit, isAdminRole } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { InviteForm } from "@/app/admin/recruitment/new/invite-form";
import { myRecruiterTeams } from "@/server/recruitment/actions";
import { PendingInvites } from "@/components/recruitment/pending-invites";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invite Candidate · Enshrine Portal" };

// Portal-side recruitment (16-Jul #12): a Manager and above (A9) invites a
// candidate from their own office. Same action + form as the admin surface,
// reachable by the people who actually recruit. Non-recruiters (incl. Sales
// Assistant Manager) are bounced to the dashboard.
export default async function PortalInvitePage() {
  const session = await auth();
  if (!session || !canRecruit(session.user.role)) redirect("/portal/dashboard");

  const t = await getTranslations("recruitment");
  const [uplines, h] = await Promise.all([
    prisma.associate.findMany({
      where: { archivedAt: null, associateStatus: "Active" },
      orderBy: { associateCode: "asc" },
      select: { associateCode: true, fullName: true, designation: true },
    }),
    headers(),
  ]);
  // Team rule: the dropdown (every active team) is Business Admin only; a
  // manager/director gets their own team(s), implied by the form.
  const isAdmin = isAdminRole(session.user.role);
  const teamOptions = isAdmin
    ? (await prisma.team.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } })).map((x) => x.name)
    : await myRecruiterTeams();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = env.AUTH_URL ?? (host ? `${proto}://${host}` : "");

  return (
    <>
      <PageHeader title={t("new.title")} subtitle={t("new.subtitle")} />
      <InviteForm
        isAdmin={isAdmin}
        baseUrl={baseUrl}
        teamOptions={teamOptions}
        uplines={uplines.map((u) => ({ code: u.associateCode, label: `${u.associateCode} · ${u.fullName} (${humanize(u.designation)})` }))}
      />

      <PendingInvites userId={session.user.id} />
    </>
  );
}
