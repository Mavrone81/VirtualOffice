"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { uploadSignedInvoice } from "@/server/invoices/actions";

// 16-Jul signed-invoice precursor: the closing associate uploads the client-
// signed PDF. Hidden file input + a button; PDF only, re-uploadable to replace.
export function SignedInvoiceUpload({ invoiceId, hasSigned }: { invoiceId: string; hasSigned: boolean }) {
  const t = useTranslations("portal");
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    start(async () => {
      setErr(undefined);
      const r = await uploadSignedInvoice(invoiceId, file);
      if (!r.ok) setErr(r.error ?? t("invoices.uploadFailed"));
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={onChange} />
      <Button size="sm" variant={hasSigned ? "ghost" : "secondary"} disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? "…" : hasSigned ? t("invoices.replaceSigned") : t("invoices.uploadSigned")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
