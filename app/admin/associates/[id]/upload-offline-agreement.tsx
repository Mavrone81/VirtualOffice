"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { uploadOfflineSignedAgreement } from "@/server/associates/actions";

/**
 * C-4: admin uploads an Associate Agreement signed OFFLINE (paper, outside
 * the portal) — only ever shown when the associate has no portal-signed
 * agreement on file (the page only renders this when `!a.signedAgreementFileKey`);
 * the server action refuses it again regardless, so this is a convenience,
 * not the only guard.
 */
export function UploadOfflineAgreementButton({ associateId }: { associateId: string }) {
  const t = useTranslations("associates");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  function pick() {
    setError(undefined);
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after an error
    if (!file) return;
    start(async () => {
      const r = await uploadOfflineSignedAgreement(associateId, file);
      if (r.ok) router.refresh();
      else setError(r.error ?? t("offlineAgreement.failed"));
    });
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={onChange} />
      <Button variant="secondary" size="sm" onClick={pick} disabled={pending}>
        {pending ? t("offlineAgreement.uploading") : t("offlineAgreement.button")}
      </Button>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
