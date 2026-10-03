import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { PendingInvites } from "@/components/recruitment/pending-invites";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Invite Candidate · Enshrine Admin" };

export default async function InviteCandidatePage() {
  const t = await getTranslations("recruitment");
  const session = await auth();

  // A Business Admin can place a candidate into any team, so the choice is
  // every active team already created (Admin → Teams) — a dropdown, not
  // free text, so a typo can't invent a team that doesn't exist.
  const [uplines, teams, h] = await Promise.all([
    prisma.associate.findMany({
      where: { archivedAt: null, associateStatus: "Active" },
      orderBy: { associateCode: "asc" },
      select: { associateCode: true, fullName: true, designation: true },
    }),
    prisma.team.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
    headers(),
  ]);
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = env.AUTH_URL ?? (host ? `${proto}://${host}` : "");
  return (
    <>
      <PageHeader title={t("new.title")} subtitle={t("new.subtitle")} />
      <InviteForm
        isAdmin
        backHref="/admin/recruitment"
        baseUrl={baseUrl}
        teamOptions={teams.map((x) => x.name)}
        uplines={uplines.map((u) => ({ code: u.associateCode, label: `${u.associateCode} · ${u.fullName} (${humanize(u.designation)})` }))}
      />
      {session?.user && <PendingInvites userId={session.user.id} />}
    </>
  );
}
