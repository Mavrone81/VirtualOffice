"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/app/onboard/[token]/signature-pad";
import { signQuotationOnSystem } from "./actions";

// Capture the client's acceptance of the quotation on-system (23-Jul parallel
// workflow, issue 4). The signed PDF is stored as a Signed docket document,
// which unlocks Close Sale — the same effect as uploading a signed copy.
export function SignQuotation({ submissionId }: { submissionId: string }) {
  const t = useTranslations("quotations");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const router = useRouter();

  function submit() {
    if (!name.trim() || !sig) return;
    setErr(undefined);
    start(async () => {
      const r = await signQuotationOnSystem(submissionId, sig, name);
      if (r.ok) { setOpen(false); setName(""); setSig(null); router.refresh(); }
      else setErr(r.error ?? t("detail.failed"));
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{t("signOnSystem")}</Button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-white p-3">
      <div className="mb-2 text-[12px] font-medium text-ink">{t("signTitle")}</div>
      <Label htmlFor={`sn-${submissionId}`}>{t("signerName")}</Label>
      <Input id={`sn-${submissionId}`} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("signerNamePlaceholder")} className="mb-3" />
      <SignaturePad onChange={setSig} />
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !name.trim() || !sig}>
          {pending ? "…" : t("signAttach")}
        </Button>
        <button type="button" className="text-[12px] text-muted hover:underline" onClick={() => { setOpen(false); setSig(null); }}>
          {t("cancel")}
        </button>
        {err && <span className="text-[11px] text-danger">{err}</span>}
      </div>
    </div>
  );
}
