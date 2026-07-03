import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { AssociateRowActions } from "./row-actions";

export const metadata = { title: "Associate Master · Enshrine Admin" };

export default async function AssociatesPage() {
  const t = await getTranslations("associates");

  const associates = await prisma.associate.findMany({
    orderBy: { associateCode: "asc" },
    include: { directUpline: true, user: true },
  });

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")}>
        <Button asChild variant="secondary">
          {/* download route handler (CSV), not a page — a real <a> is correct here */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/admin/associates/export">{t("exportContacts")}</a>
        </Button>
        <Button asChild>
          <Link href="/admin/associates/new">{t("newAssociate")}</Link>
        </Button>
      </PageHeader>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-medium">{t("col.id")}</th>
                <th className="px-5 py-3 font-medium">{t("col.associate")}</th>
                <th className="px-5 py-3 font-medium">{t("col.division")}</th>
                <th className="px-5 py-3 font-medium">{t("col.designation")}</th>
                <th className="px-5 py-3 font-medium">{t("col.upline")}</th>
                <th className="px-5 py-3 font-medium">{t("col.login")}</th>
                <th className="px-5 py-3 font-medium">{t("col.approval")}</th>
                <th className="px-5 py-3 font-medium">{t("col.status")}</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {associates.map((a) => (
                <tr key={a.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/admin/associates/${a.id}`} className="text-action hover:underline">{a.associateCode}</Link>
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/admin/associates/${a.id}`} className="text-ink hover:underline">{a.fullName}</Link>
                    {a.businessName && <div className="text-[11px] text-muted-2">{a.businessName}</div>}
                  </td>
                  <td className="px-5 py-3 text-muted">{a.teamName ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{humanize(a.designation)}</td>
                  <td className="px-5 py-3 text-muted">{a.directUpline?.associateCode ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-2">{a.user ? "✓" : "—"}</td>
                  <td className="px-5 py-3"><StatusPill status={a.approvalStatus} /></td>
                  <td className="px-5 py-3"><StatusPill status={a.associateStatus} /></td>
                  <td className="px-5 py-3">
                    <AssociateRowActions id={a.id} approval={a.approvalStatus} status={a.associateStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
