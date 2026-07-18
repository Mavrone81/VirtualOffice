import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canRecruit } from "@/lib/rbac";
import { humanize } from "@/lib/labels";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { InviteForm } from "@/app/admin/recruitment/new/invite-form";

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

  return (
    <>
      <PageHeader title={t("new.title")} subtitle={t("new.subtitle")} />
      <InviteForm
        baseUrl={baseUrl}
        uplines={uplines.map((u) => ({ code: u.associateCode, label: `${u.associateCode} · ${u.fullName} (${humanize(u.designation)})` }))}
      />
    </>
  );
}
