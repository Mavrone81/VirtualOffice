import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Invite candidate · Enshrine Admin" };

export default async function InviteCandidatePage() {
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
