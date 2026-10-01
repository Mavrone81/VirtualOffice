"use client";

import { useState, useTransition } from "react";

/**
 * A-6/A-7: the voucher route's GET never mints (platform-fired GETs must not
 * freeze an immutable financial record nobody asked for) — only POST issues
 * or returns the existing one. So a plain <a href> can't be used here (it
 * would 404 on first click for a not-yet-issued voucher); this always POSTs,
 * which is correct whether the voucher already exists or not.
 */
export function VoucherDownloadButton({ transactionId, payoutId, label, pendingLabel, failedLabel }: {
  transactionId: string;
  payoutId: string;
  label: string;
  pendingLabel: string;
  failedLabel: string;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  function onClick() {
    setFailed(false);
    start(async () => {
      try {
        const res = await fetch(`/portal/transactions/${transactionId}/voucher?payoutId=${payoutId}`, { method: "POST" });
        if (!res.ok) { setFailed(true); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener");
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <span className="flex flex-col gap-0.5">
      <button type="button" onClick={onClick} disabled={pending} className="text-left text-[12px] text-action hover:underline disabled:opacity-50">
        {pending ? pendingLabel : label}
      </button>
      {failed && <span className="text-[11px] text-danger">{failedLabel}</span>}
    </span>
  );
}
