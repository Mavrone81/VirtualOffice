"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  markInvoicePaid, markInstallmentPaid, markInvoiceUnpaid, markInstallmentUnpaid,
} from "@/server/invoices/actions";

// Business-Admin payment tracking (16-Jul Flow 4 + Issues v1.0 #6; B-7: a
// required payment acknowledgement upload, and un-mark gated to Business
// Admin with a required reason). This is a functional STOPGAP wired to the
// real action signatures — Frontend owns the B-7 UI redesign (docs/design/
// b7-invoices.md: file-required Confirm-disabled dialog, the three-state
// unmark control, "View acknowledgement") on top of this branch.
export function MarkPaidButton({ id, kind, paid = false }: { id: string; kind: "invoice" | "installment"; paid?: boolean }) {
  const t = useTranslations("invoices");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const [dialog, setDialog] = useState(false);
  const [method, setMethod] = useState<"Cash" | "Credit" | "Bank">("Bank");
  const [reference, setReference] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) =>
    start(async () => {
      setErr(undefined);
      const r = await fn();
      if (r.ok) { onOk?.(); router.refresh(); }
      else setErr(r.error ?? t("failed"));
    });

  const confirmPaid = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr(t("payment.ackLabel")); return; }
    run(
      () => (kind === "invoice" ? markInvoicePaid(id, file, { method, reference }) : markInstallmentPaid(id, file, { method, reference })),
      () => setDialog(false),
    );
  };

  const confirmUnpaid = () => {
    const reason = window.prompt(t("markUnpaidReason"))?.trim();
    if (!reason) return;
    run(() => (kind === "invoice" ? markInvoiceUnpaid(id, reason) : markInstallmentUnpaid(id, reason)));
  };

  if (paid) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={pending} onClick={confirmUnpaid}>
          {pending ? "…" : t("markUnpaid")}
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
      <div className="flex flex-col gap-1">
        <span className="text-muted">{t("payment.ackLabel")}</span>
        <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="text-[12px]" />
        <span className="text-[10px] text-muted">{t("payment.ackHint")}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={confirmPaid}>
          {pending ? "…" : t("payment.confirm")}
        </Button>
        <button type="button" className="text-muted hover:underline" onClick={() => setDialog(false)}>{t("payment.cancel")}</button>
      </div>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </div>
  );
}
