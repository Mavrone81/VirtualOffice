"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Banner } from "@/components/ui/banner";
import { formatSGD } from "@/lib/money";
import { runPayouts, approveAllPayouts } from "@/server/payouts/actions";

export function RunPayoutsBar({
  month, total, payCount, hasWork, carriedCount, blockedCount,
}: {
  month: string; total: string; payCount: number;
  /** Any plan row at all — a run with only carried/held rows or stuck payouts to release still does real work (U2). */
  hasWork: boolean;
  carriedCount: number; blockedCount: number;
}) {
  const t = useTranslations("payouts");
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const router = useRouter();

  function run() {
    setMsg(undefined);
    setConflict(false);
    start(async () => {
      const r = await runPayouts(month);
      setConfirmOpen(false);
      if (r.ok) { setMsg(t("run.success", { count: r.count, month })); router.refresh(); return; }
      if (r.code === "payoutRunConflict") { setConflict(true); setMsg(t("run.conflict")); return; }
      if (r.code === "payoutPolicyNotImplemented") { setMsg(t("run.policyUnavailable")); return; }
      setMsg(r.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={pending || !hasWork}
        onClick={() => { setConfirmOpen(true); setConflict(false); }}
      >
        {t("run.buttonWithTotal", { amount: formatSGD(total), count: payCount })}
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { await approveAllPayouts(month); router.refresh(); })}>
        {t("approveAll")}
      </Button>
      {msg && <span className={`text-[12px] ${conflict ? "text-danger" : "text-muted"}`}>{msg}</span>}
      {conflict && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => { setMsg(undefined); setConflict(false); router.refresh(); }}>
          {t("run.reloadPreview")}
        </Button>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal>
          <Card className="w-full max-w-md p-5">
            <h2 className="mb-3 font-display text-[17px] text-ink">{t("run.confirmTitle", { month })}</h2>
            <p className="mb-2 text-[13px] text-body">{t("run.buttonWithTotal", { amount: formatSGD(total), count: payCount })}</p>
            {carriedCount > 0 && <p className="mb-1 text-[12px] text-muted">{t("run.confirmCarriedNote", { count: carriedCount })}</p>}
            {blockedCount > 0 && <p className="mb-3 text-[12px] text-muted">{t("run.confirmBlockedNote", { count: blockedCount })}</p>}
            {msg && <Banner tone="danger">{msg}</Banner>}
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" disabled={pending} onClick={run}>{pending ? "…" : t("runPayouts")}</Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirmOpen(false)}>{t("cancel")}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
