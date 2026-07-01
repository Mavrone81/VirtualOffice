"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markInvoicePaid, markInstallmentPaid } from "@/server/invoices/actions";

export function MarkPaidButton({ id, kind }: { id: string; kind: "invoice" | "installment" }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = kind === "invoice" ? await markInvoicePaid(id) : await markInstallmentPaid(id);
            if (!r.ok) setErr(r.error ?? "Failed");
          })
        }
      >
        {pending ? "…" : "Mark paid"}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
