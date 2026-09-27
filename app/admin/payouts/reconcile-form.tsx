"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Banner } from "@/components/ui/banner";
import { formatSGD } from "@/lib/money";
import { getReconcileTarget } from "@/server/payouts/reconcile-candidates";
import { reconcileLegacyPayout } from "@/server/payouts/actions";
import type { ReconcileTarget } from "@/server/payouts/reconcile-candidates";

/** "YYYY-MM" -> the first of that month, for locale-aware display (no formatting here — see useFormatter in the component). */
function firstOfMonth(ym: string): Date | null {
  const [y, m] = ym.split("-").map(Number);
  return y && m ? new Date(y, m - 1, 1) : null;
}

export function ReconcileButton({ associateId, associateName }: { associateId: string; associateName: string }) {
  const t = useTranslations("payouts");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<ReconcileTarget | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string>();

  function openForm() {
    setOpen(true);
    setLoadError(undefined);
    start(async () => {
      const r = await getReconcileTarget(associateId);
      if (!r.ok) { setLoadError(r.error); return; }
      setTarget(r.target);
    });
  }

  if (!open) {
    return <Button size="sm" variant="secondary" onClick={openForm}>{t("preview.reconcileAction")}</Button>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal>
      <Card className="w-full max-w-lg p-5">
        <h2 className="mb-3 font-display text-[17px] text-ink">{t("reconcile.title", { associate: associateName })}</h2>
        {pending && target === undefined ? (
          <p className="text-[13px] text-muted">…</p>
        ) : loadError ? (
          <>
            <Banner tone="danger">{loadError}</Banner>
            <div className="mt-4"><Button size="sm" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button></div>
          </>
        ) : target === null ? (
          <>
            <Banner tone="info">{t("reconcile.alreadyProcessed")}</Banner>
            <div className="mt-4"><Button size="sm" variant="secondary" onClick={() => { setOpen(false); }}>{t("cancel")}</Button></div>
          </>
        ) : target ? (
          <ReconcileFields associateName={associateName} target={target} onClose={() => setOpen(false)} />
        ) : null}
      </Card>
    </div>
  );
}

function ReconcileFields({ target, onClose }: { associateName: string; target: ReconcileTarget; onClose: () => void }) {
  const t = useTranslations("payouts");
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [diffAmount, setDiffAmount] = useState("");
  const [diffReason, setDiffReason] = useState("");
  const [error, setError] = useState<string>();

  const tickedSum = target.lines.filter((l) => checked.has(l.id)).reduce((s, l) => s + Number(l.amount), 0);
  const total = Number(target.totalPayable);
  // Signed per the server's exact requirement (ticked sum − payout total). The
  // input itself only ever shows/collects the unsigned magnitude, matching the
  // "{diff} short of the payout's {total}" copy — the sign is applied at
  // submit time from tickedSum vs total, not asked of the admin (DevLead U3:
  // the server needs the exact signed value, but Accounts shouldn't have to
  // reason about which direction is negative). NOT pre-filled (DevLead
  // follow-up): the computed gap is shown in the note text only — Accounts
  // must re-type the magnitude themselves, confirming it against their bank
  // records (✚F2), rather than being able to submit an unconfirmed default.
  const signedDiff = tickedSum - total;
  const unsignedDiff = Math.abs(signedDiff);
  const mismatch = checked.size > 0 && unsignedDiff > 0.001;
  const needsDifference = mismatch;
  const canSubmit = checked.size > 0 && reason.trim().length > 0 && (!needsDifference || (diffAmount.trim() && diffReason.trim().length > 0));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(undefined);
    start(async () => {
      const magnitude = Math.abs(Number(diffAmount) || 0);
      const signedAmount = signedDiff < 0 ? -magnitude : magnitude;
      const r = await reconcileLegacyPayout(
        target.payoutId,
        [...checked],
        reason,
        needsDifference ? { amount: signedAmount.toFixed(2), reason: diffReason } : undefined,
      );
      if (r.ok) { router.refresh(); onClose(); return; }
      switch (r.code) {
        case "alreadyProcessed":
          router.refresh(); onClose(); return;
        case "notFound":
          setError(t("reconcile.notFound")); return;
        case "illegalPayoutTransition":
          setError(t("reconcile.illegalTransition")); return;
        // legacyDifferenceRequired / legacyDifferenceMismatch / forbidden: the
        // server's own translated `error` (errors.legacyDifferenceRequired etc.)
        // is already the right copy — no bespoke reconcile.* string needed.
        default:
          setError(r.error);
      }
    });
  }

  return (
    <>
      <p className="mb-3 text-[13px] text-body">{t("reconcile.instructions", { amount: formatSGD(target.totalPayable) })}</p>
      <div className="mb-4 max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-line p-2">
        {target.lines.map((l) => {
          const d = firstOfMonth(l.payoutMonth);
          return (
            <label key={l.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-paper-100">
              <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggle(l.id)} />
              <span className="font-medium text-ink">{l.transactionCode}</span>
              <span className="text-muted">· {d ? format.dateTime(d, { year: "numeric", month: "short" }) : l.payoutMonth}</span>
              <span className="ml-auto text-ink">{formatSGD(l.amount)}</span>
            </label>
          );
        })}
      </div>

      <Label htmlFor="reconcile-reason">{t("reconcile.reasonRequired")}</Label>
      <Input id="reconcile-reason" className="mb-4" value={reason} onChange={(e) => setReason(e.target.value)} />

      {needsDifference && (
        <Banner tone="warn">
          <p className="mb-2">
            {t("reconcile.differenceNote", { ticked: formatSGD(tickedSum), total: formatSGD(target.totalPayable), diff: formatSGD(unsignedDiff) })}
          </p>
          <Label htmlFor="diff-amount">{t("reconcile.differenceAmount")}</Label>
          <Input
            id="diff-amount" className="mb-2" value={diffAmount}
            onChange={(e) => setDiffAmount(e.target.value)}
            placeholder="0.00"
          />
          <Label htmlFor="diff-reason">{t("reconcile.differenceReason")}</Label>
          <Input id="diff-reason" value={diffReason} onChange={(e) => setDiffReason(e.target.value)} />
        </Banner>
      )}

      {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" disabled={!canSubmit || pending} onClick={submit}>
          {pending ? "…" : t("reconcile.confirm")}
        </Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={onClose}>{t("cancel")}</Button>
      </div>
    </>
  );
}
