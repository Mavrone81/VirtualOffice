"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  markInvoicePaid, markInstallmentPaid, markInvoiceUnpaid, markInstallmentUnpaid,
} from "@/server/invoices/actions";

// Business-Admin payment tracking (16-Jul Flow 4): toggle an invoice or an
// installment between Paid and Unpaid. Marking Paid accrues commission once the
// release threshold (3rd installment / full payment) is met; Unpaid reverts it.
export function MarkPaidButton({ id, kind, paid = false }: { id: string; kind: "invoice" | "installment"; paid?: boolean }) {
  const t = useTranslations("invoices");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();

  const run = () =>
    start(async () => {
      const action = paid
        ? kind === "invoice" ? markInvoiceUnpaid : markInstallmentUnpaid
        : kind === "invoice" ? markInvoicePaid : markInstallmentPaid;
      const r = await action(id);
      if (!r.ok) setErr(r.error ?? t("failed"));
    });

  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant={paid ? "ghost" : "secondary"} disabled={pending} onClick={run}>
        {pending ? "…" : paid ? t("markUnpaid") : t("markPaid")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
