"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { approveQuotation, rejectSubmission } from "@/server/sales/actions";

// Business Admin decision at the quotation-review stage (16-Jul quotation
// workflow): Approve → creates the transaction/ledger (Pending) and unlocks the
// rep's quotation; Reject → closes the submission.
export function ApproveRejectButtons({ id }: { id: string }) {
  const t = useTranslations("quotations");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    start(async () => {
      const r = await fn();
      if (r.ok) router.push("/admin/quotations");
      else setError(r.error ?? t("detail.failed"));
    });
  }

  return (
    <div className="space-y-3">
      <Button className="w-full" onClick={() => run(() => approveQuotation(id))} disabled={pending}>
        {pending ? tc("saving") : t("detail.approve")}
      </Button>

      {rejecting ? (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("detail.reasonPlaceholder")}
            className="min-h-[60px] w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink focus:border-action focus:outline-none"
          />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => run(() => rejectSubmission(id, reason))} disabled={pending}>
              {t("detail.confirmReject")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(false)} disabled={pending}>{tc("cancel")}</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" className="w-full" onClick={() => setRejecting(true)} disabled={pending}>{t("detail.reject")}</Button>
      )}

      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
