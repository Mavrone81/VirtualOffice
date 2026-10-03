import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { TABLE_HEAD_ROW_CLS, TABLE_HEAD_CELL_CLS } from "@/components/ui/table";
import { CancelInviteButton } from "./cancel-invite-button";

/**
 * "My invites" (Issues v1.0): candidates the signed-in user invited that are not
 * yet converted or rejected — cancellable here. Shared by the admin and the
 * manager/director invite pages so both run the same pipeline view; cancelInvite
 * itself already allows the inviter or a Business Admin.
 */
export async function PendingInvites({ userId }: { userId: string }) {
  const t = await getTranslations("recruitment");
  const invites = await prisma.candidate.findMany({
    where: {
      invitedById: userId,
      convertedAssociateId: null,
      onboardingStage: { not: "Rejected" },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, fullName: true, email: true, onboardingStage: true, createdAt: true },
  });

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="border-b border-line px-5 py-3 font-display text-[15px] text-ink">{t("invites.title")}</div>
      {invites.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted">{t("invites.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className={TABLE_HEAD_ROW_CLS}>
                <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("invites.colName")}</th>
                <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("invites.colEmail")}</th>
                <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("invites.colStage")}</th>
                <th className={`px-5 py-3 font-medium ${TABLE_HEAD_CELL_CLS}`}>{t("invites.colInvited")}</th>
                <th className={`px-5 py-3 ${TABLE_HEAD_CELL_CLS}`}></th>
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
  );
}
