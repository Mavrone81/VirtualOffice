import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Audit log · Enshrine Admin" };

export default async function AuditLogPage() {
  const t = await getTranslations("audit");
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  const actorIds = [...new Set(logs.map((l) => l.actorUserId).filter((x): x is string => !!x))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })
    : [];
  const emailOf = new Map(actors.map((a) => [a.id, a.email]));

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="overflow-hidden">
        {logs.length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">{t("col.when")}</th>
                  <th className="px-5 py-3 font-medium">{t("col.actor")}</th>
                  <th className="px-5 py-3 font-medium">{t("col.action")}</th>
                  <th className="px-5 py-3 font-medium">{t("col.entity")}</th>
                  <th className="px-5 py-3 font-medium">{t("col.detail")}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const detail = l.afterJson ?? l.beforeJson;
                  return (
                    <tr key={l.id} className="border-b border-line-200 last:border-0 hover:bg-paper-100">
                      <td className="px-5 py-3 whitespace-nowrap text-muted">{format(l.createdAt, "dd MMM yyyy, HH:mm")}</td>
                      <td className="px-5 py-3 text-muted">{l.actorUserId ? emailOf.get(l.actorUserId) ?? "—" : t("actorSystem")}</td>
                      <td className="px-5 py-3"><span className="rounded-md bg-paper-200 px-1.5 py-0.5 font-mono text-[11px] text-ink">{l.action}</span></td>
                      <td className="px-5 py-3 text-muted">
                        {l.entityType}
                        {l.entityId ? <span className="ml-1 text-[11px] text-muted-2">{l.entityId.slice(0, 8)}</span> : null}
                      </td>
                      <td className="px-5 py-3 text-muted-2">
                        {detail ? <span className="font-mono text-[11px]">{JSON.stringify(detail)}</span> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
