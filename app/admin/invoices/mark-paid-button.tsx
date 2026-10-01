"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/ui/banner";
import {
  markInvoicePaid, markInstallmentPaid, markInvoiceUnpaid, markInstallmentUnpaid,
} from "@/server/invoices/actions";
import type { SettledReason } from "@/server/invoices/settled-check";

type Kind = "invoice" | "installment";
type Method = "Cash" | "Credit" | "Bank";

/**
 * Owner ruling (reverses #21): the payment-acknowledgement upload is
 * optional, both for invoices and installments — Confirm no longer waits
 * on a file being attached.
 */
export function MarkPaidButton({ id, kind }: { id: string; kind: Kind }) {
  const t = useTranslations("invoices");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState(false);
  const [method, setMethod] = useState<Method>("Bank");
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string>();

  function confirm() {
    setErr(undefined);
    start(async () => {
      const r = kind === "invoice"
        ? await markInvoicePaid(id, file, { method, reference: reference.trim() || undefined })
        : await markInstallmentPaid(id, file, { method, reference: reference.trim() || undefined });
      if (r.ok) { setDialog(false); router.refresh(); }
      else setErr(r.error ?? t("failed"));
    });
  }

  if (!dialog) {
    return <Button size="sm" variant="secondary" onClick={() => setDialog(true)}>{t("markPaid")}</Button>;
  }

  return (
    <div className="inline-flex flex-col gap-2 rounded-lg border border-line bg-paper-100 p-3 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="text-muted">{t("payment.method")}</span>
        <select className="h-8 rounded-lg border border-line bg-white px-2 text-[12px] text-ink" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
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
        <Label htmlFor={`ack-${id}`} className="mb-0 text-[12px]">{t("payment.ackLabel")}</Label>
        <input
          id={`ack-${id}`} type="file" accept="application/pdf,image/jpeg,image/png" className="text-[12px]"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(undefined); }}
        />
        <span className="text-[10px] text-muted">{t("payment.ackHint")}</span>
      </div>
      {err && <Banner tone="danger">{err}</Banner>}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={confirm}>
          {pending ? "…" : t("payment.confirm")}
        </Button>
        <button type="button" className="text-muted hover:underline" onClick={() => setDialog(false)}>{t("payment.cancel")}</button>
      </div>
    </div>
  );
}

/**
 * B-7 Screen 2: three states per row —
 *  - `canUnmark: false` (not Business Admin): no control at all (the caller
 *    already renders "View acknowledgement" separately).
 *  - `blockedReason` set (commission already settled, in either sense
 *    findSettledReasons checks): shown disabled with a tooltip naming WHICH
 *    reason applies — honest ("blocked by data, not by role"), not hidden.
 *    Reuses the "errors" namespace copy refuseIfSettled itself returns
 *    (ADR-0001 §7 — one message per reason, not a UI-side re-derivation).
 *  - otherwise: enabled, opens a required-reason dialog.
 */
export function UnmarkButton({ id, kind, canUnmark, blockedReason }: { id: string; kind: Kind; canUnmark: boolean; blockedReason?: SettledReason }) {
  const t = useTranslations("invoices");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string>();

  if (!canUnmark) return null;

  if (blockedReason) {
    return (
      <Button size="sm" variant="ghost" disabled title={te(blockedReason)}>
        {t("markUnpaid")}
      </Button>
    );
  }

  function confirm() {
    if (!reason.trim()) return;
    setErr(undefined);
    start(async () => {
      const r = kind === "invoice" ? await markInvoiceUnpaid(id, reason) : await markInstallmentUnpaid(id, reason);
      if (r.ok) { setDialog(false); router.refresh(); }
      else setErr(r.error ?? t("failed"));
    });
  }

  if (!dialog) {
    return <Button size="sm" variant="ghost" onClick={() => setDialog(true)}>{t("markUnpaid")}</Button>;
  }

  return (
    <div className="inline-flex flex-col gap-2 rounded-lg border border-line bg-paper-100 p-3 text-[12px]">
      <Label htmlFor={`unpaid-reason-${id}`} className="mb-0 text-[12px]">{t("markUnpaidReason")}</Label>
      <Input id={`unpaid-reason-${id}`} className="h-8 text-[12px]" value={reason} onChange={(e) => setReason(e.target.value)} />
      {err && <Banner tone="danger">{err}</Banner>}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!reason.trim() || pending} onClick={confirm}>
          {pending ? "…" : t("markUnpaidConfirm")}
        </Button>
        <button type="button" className="text-muted hover:underline" onClick={() => setDialog(false)}>{t("payment.cancel")}</button>
      </div>
    </div>
  );
}
