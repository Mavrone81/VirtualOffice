"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { addSubmissionRequiredDocument } from "@/server/sales/actions";

// A-17 G3a: one upload control per still-missing required-document key.
// Append-only server-side — a successful upload just re-renders this key as
// attached on the next revalidated load (router.refresh(), matching
// addSubmissionRequiredDocument's revalidatePath of this exact page).
export function RequiredDocUpload({ submissionId, requirementKey, label, onDone }: { submissionId: string; requirementKey: string; label: string; onDone: () => void }) {
  const t = useTranslations("portal");
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    start(async () => {
      setErr(undefined);
      const r = await addSubmissionRequiredDocument(submissionId, requirementKey, file);
      if (r.ok) onDone();
      else setErr(r.error ?? t("saleDetail.requiredDocUploadFailed"));
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <span className="flex items-center justify-between gap-2 text-[12px]">
      <span className="text-ink">{label}</span>
      <span className="flex items-center gap-2">
        <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={onChange} />
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => inputRef.current?.click()}>
          {pending ? "…" : t("saleDetail.requiredDocUpload")}
        </Button>
        {err && <span className="text-danger">{err}</span>}
      </span>
    </span>
  );
}
