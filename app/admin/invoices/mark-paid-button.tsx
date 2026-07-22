"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  markInvoicePaid, markInstallmentPaid, markInvoiceUnpaid, markInstallmentUnpaid,
} from "@/server/invoices/actions";

// Business-Admin payment tracking (16-Jul Flow 4 + Issues v1.0 #6). Marking an
// invoice Paid opens a dialog to capture the payment method + reference; the
// Unpaid toggle and installment Paid stay one-click. Marking Paid accrues
// commission once the release threshold is met; Unpaid reverts it.
export function MarkPaidButton({ id, kind, paid = false }: { id: string; kind: "invoice" | "installment"; paid?: boolean }) {
  const t = useTranslations("invoices");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const [dialog, setDialog] = useState(false);
  const [method, setMethod] = useState<"Cash" | "Credit" | "Bank">("Bank");
  const [reference, setReference] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) =>
    start(async () => {
      setErr(undefined);
      const r = await fn();
      if (r.ok) { onOk?.(); router.refresh(); }
      else setErr(r.error ?? t("failed"));
    });

  if (paid) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => (kind === "invoice" ? markInvoiceUnpaid(id) : markInstallmentUnpaid(id)))}>
          {pending ? "…" : t("markUnpaid")}
        </Button>
        {err && <span className="text-[11px] text-danger">{err}</span>}
      </span>
    );
  }

  if (kind === "installment") {
    return (
      <span className="inline-flex items-center gap-1">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => markInstallmentPaid(id))}>
          {pending ? "…" : t("markPaid")}
        </Button>
        {err && <span className="text-[11px] text-danger">{err}</span>}
      </span>
    );
  }

  if (!dialog) {
    return <Button size="sm" variant="secondary" onClick={() => setDialog(true)}>{t("markPaid")}</Button>;
  }

  return (
    <div className="inline-flex flex-col gap-2 rounded-lg border border-line bg-paper-100 p-3 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="text-muted">{t("payment.method")}</span>
        <select className="h-8 rounded-lg border border-line bg-white px-2 text-[12px] text-ink" value={method} onChange={(e) => setMethod(e.target.value as "Cash" | "Credit" | "Bank")}>
          <option value="Cash">{t("payment.cash")}</option>
          <option value="Credit">{t("payment.credit")}</option>
          <option value="Bank">{t("payment.bank")}</option>
        </select>
      </div>
      <input
        className="h-8 rounded-lg border border-line bg-white px-2 text-[12px] text-ink focus:border-action focus:outline-none"
        placeholder={t("payment.reference")}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => markInvoicePaid(id, { method, reference }), () => setDialog(false))}>
          {pending ? "…" : t("payment.confirm")}
        </Button>
        <button type="button" className="text-muted hover:underline" onClick={() => setDialog(false)}>{t("payment.cancel")}</button>
      </div>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </div>
  );
}
