import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canRecruit } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { env } from "@/lib/env";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { InviteForm } from "@/app/admin/recruitment/new/invite-form";
import { CancelInviteButton } from "./cancel-invite-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invite candidate · Enshrine Portal" };

// Portal-side recruitment (16-Jul #12): a manager (SAM+) invites a candidate
// from their own office. Same action + form as the admin surface, reachable by
// the people who actually recruit. Non-recruiters are bounced to the dashboard.
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
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = env.AUTH_URL ?? (host ? `${proto}://${host}` : "");

  // My pending invites (Issues v1.0): candidates I invited that are not yet
  // converted or rejected — cancellable here.
  const invites = await prisma.candidate.findMany({
    where: {
      invitedById: session.user.id,
      convertedAssociateId: null,
      onboardingStage: { not: "Rejected" },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, fullName: true, email: true, onboardingStage: true, createdAt: true },
  });

  return (
    <>
      <PageHeader title={t("new.title")} subtitle={t("new.subtitle")} />
      <InviteForm
        baseUrl={baseUrl}
        uplines={uplines.map((u) => ({ code: u.associateCode, label: `${u.associateCode} · ${u.fullName} (${humanize(u.designation)})` }))}
      />

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line px-5 py-3 font-display text-[15px] text-ink">{t("invites.title")}</div>
        {invites.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted">{t("invites.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("invites.colName")}</th>
                  <th className="px-5 py-3 font-medium">{t("invites.colEmail")}</th>
                  <th className="px-5 py-3 font-medium">{t("invites.colStage")}</th>
                  <th className="px-5 py-3 font-medium">{t("invites.colInvited")}</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((c) => (
                  <tr key={c.id} className="border-b border-line-200 last:border-0">
                    <td className="px-5 py-3 text-ink">{c.fullName}</td>
                    <td className="px-5 py-3 text-muted">{c.email}</td>
                    <td className="px-5 py-3"><StatusPill status={c.onboardingStage} /></td>
                    <td className="px-5 py-3 text-muted">{format(c.createdAt, "dd MMM yyyy")}</td>
                    <td className="px-5 py-3 text-right"><CancelInviteButton id={c.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
