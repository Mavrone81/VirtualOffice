"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { uploadDocketDocuments } from "./actions";

// Rep uploads client-signed documents into a sale's docket (16-Jul quotation
// workflow). Freeform, multiple; kept under the 10 MB Server Action body limit.
export function DocketUpload({ submissionId }: { submissionId: string }) {
  const t = useTranslations("portal");
  const tc = useTranslations("common");
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function upload() {
    if (!files.length) return;
    setError(undefined);
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > 9_000_000) { setError(t("saleForm.docsTooLarge")); return; }
    start(async () => {
      const r = await uploadDocketDocuments(submissionId, files);
      if (r.ok) { setFiles([]); router.refresh(); }
      else setError(r.error ?? t("quotations.uploadFailed"));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="text-[12px] text-muted file:mr-2 file:rounded-lg file:border file:border-line file:bg-paper-100 file:px-2 file:py-1 file:text-[11px] file:text-ink hover:file:bg-paper-200"
      />
      <Button size="sm" onClick={upload} disabled={pending || !files.length}>
        {pending ? tc("saving") : t("quotations.uploadSigned")}
      </Button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
