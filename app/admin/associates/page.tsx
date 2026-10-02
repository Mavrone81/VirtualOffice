import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Designation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/labels";
import { teamScopeIds } from "@/lib/team";
import { associateWhere, parseAssociateSearch, type AssociateSearch } from "@/server/associates/list-filters";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { FilterBar, type FilterField } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { AssociateRowActions } from "./row-actions";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";

export const metadata = { title: "Associate Master · Enshrine Admin" };

const MANAGER_DESIGNATIONS: Designation[] = [Designation.SalesManager, Designation.SalesDirector];

export default async function AssociatesPage({ searchParams }: { searchParams: Promise<AssociateSearch> }) {
  const t = await getTranslations("associates");
  const tf = await getTranslations("filters");

  const rawSp = await searchParams;
  const sp = parseAssociateSearch(rawSp);

  const [managers, teamMemberIds] = await Promise.all([
    sp.designation && MANAGER_DESIGNATIONS.includes(sp.designation)
      ? prisma.associate.findMany({ where: { designation: sp.designation }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })
      : Promise.resolve([]),
    sp.team ? teamScopeIds(sp.team) : Promise.resolve(undefined),
  ]);

  const filtersActive = Boolean(sp.designation || sp.team);

  const associates = await prisma.associate.findMany({
    where: associateWhere({ ...sp, teamMemberIds }),
    orderBy: { associateCode: "asc" },
    include: { directUpline: true, user: true },
  });

  const fields: FilterField[] = [
    {
      type: "select", key: "designation", label: tf("designation"),
      options: Object.values(Designation).map((d) => ({ value: d, label: humanize(d) })),
    },
    ...(sp.designation && MANAGER_DESIGNATIONS.includes(sp.designation)
      ? [{
          type: "select" as const, key: "team", label: tf("team"),
          options: managers.map((m) => ({ value: m.id, label: m.fullName })),
          emptyLabel: managers.length === 0 ? tf("teamNoDownline") : undefined,
        }]
      : []),
  ];

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

      <Suspense fallback={null}>
        <FilterBar fields={fields} clearAllLabel={tf("clearAll")} />
      </Suspense>

      <Card className="overflow-hidden">
        {associates.length === 0 && filtersActive ? (
          <EmptyState message={t("emptyFiltered")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className={TABLE_HEAD_ROW_CLS}>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("col.id")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("col.associate")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("col.division")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("col.designation")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("col.upline")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("col.login")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("col.approval")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("col.status")}</th>
                  <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}></th>
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
        )}
      </Card>
    </>
  );
}
