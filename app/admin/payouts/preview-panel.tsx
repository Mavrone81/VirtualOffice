import { getTranslations } from "next-intl/server";
import { formatSGD } from "@/lib/money";
import { classifyPreviewPlans, type PreviewPlanRow } from "@/lib/payout-preview";
import { Card } from "@/components/ui/card";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { ReconcileButton } from "./reconcile-form";

export type PreviewPanelProps = {
  month: string;
  plans: PreviewPlanRow[];
  blockedAssociates: { id: string; fullName: string }[];
  canReconcile: boolean;
};

export async function PreviewPanel({ month, plans, blockedAssociates, canReconcile }: PreviewPanelProps) {
  const t = await getTranslations("payouts");
  const { willBePaid, held, carriedForward, leaverFlags, total, count } = classifyPreviewPlans(plans);
  const nothingThisMonth = willBePaid.length === 0 && held.length === 0 && carriedForward.length === 0;

  return (
    <Card className="mb-5 overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-[16px] text-ink">
          {count > 0 ? t("preview.headline", { amount: formatSGD(total), count }) : t("preview.empty", { month })}
        </h2>
      </div>

      <div className="divide-y divide-line-200">
        {willBePaid.length > 0 && (
          <section className="px-5 py-4">
            <h3 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-muted">{t("preview.willBePaid")}</h3>
            <ul className="space-y-2">
              {willBePaid.map((p) => (
                <li key={p.associateId} className="text-[13px]">
                  <span className="font-medium text-ink">{p.associateName}</span>
                  {p.releasedLines > 0 && (
                    <div className="text-[12px] text-muted">
                      {t("preview.broughtForward", { count: p.releasedLines, amount: formatSGD(p.net) })}
                    </div>
                  )}
                  <div className="text-[12px] text-body">{formatSGD(p.net)}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {held.length > 0 && (
          <section className="px-5 py-4">
            <h3 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-muted">{t("preview.heldSection")}</h3>
            <ul className="space-y-2">
              {held.map((p) => (
                <li key={p.associateId} className="text-[13px]">
                  <span className="font-medium text-ink">{p.associateName}</span>{" "}
                  <span className="text-muted">{t("preview.heldNotCarried", { amount: formatSGD(p.net) })}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {carriedForward.length > 0 && (
          <section className="px-5 py-4">
            <h3 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-muted">{t("preview.carriedSection")}</h3>
            <ul className="space-y-2">
              {carriedForward.map((p) => (
                <li key={p.associateId} className="text-[13px]">
                  <span className="font-medium text-ink">{p.associateName}</span>{" "}
                  <span className="text-muted">{t("preview.carriedForward", { amount: formatSGD(p.net) })}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {nothingThisMonth && leaverFlags.length === 0 && blockedAssociates.length === 0 && (
          <EmptyState message={t("preview.empty", { month })} />
        )}

        {blockedAssociates.length > 0 && (
          <section className="px-5 py-4">
            <h3 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-muted">{t("preview.blockedSection")}</h3>
            <ul className="space-y-2">
              {blockedAssociates.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <div>
                    <span className="font-medium text-ink">{a.fullName}</span>{" "}
                    <span className="text-muted">{t("preview.blockedReason")}</span>
                  </div>
                  {canReconcile && <ReconcileButton associateId={a.id} associateName={a.fullName} />}
                </li>
              ))}
            </ul>
          </section>
        )}

        {leaverFlags.length > 0 && (
          <section className="px-5 py-4">
            <h3 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-muted">{t("preview.flagSection")}</h3>
            <div className="space-y-2">
              {leaverFlags.map((p) => (
                <Banner key={p.associateId} tone="info">
                  <span className="font-medium">{p.associateName}</span> <span>{t("preview.flagInactive")}</span>
                  {" — "}
                  <span>{t("preview.flagBalance", { amount: formatSGD(p.net) })}</span>
                  <div className="mt-0.5">{t("preview.flagNote")}</div>
                </Banner>
              ))}
            </div>
          </section>
        )}
      </div>
    </Card>
  );
}
