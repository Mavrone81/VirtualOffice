"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { revealAssociatePii } from "@/server/associates/actions";

// Masked-by-default PII with a Business-Admin "Show" button. Decryption + the
// audit-trail entry happen on the server only when Show is clicked.
export function RevealPii({
  associateId, field, label, hasValue, canReveal,
}: {
  associateId: string;
  field: "nric" | "bankAccount";
  label: string;
  hasValue: boolean;
  canReveal: boolean;
}) {
  const t = useTranslations("associates");
  const [pending, start] = useTransition();
  const [value, setValue] = useState<string | null>(null);
  const [err, setErr] = useState<string>();

  const reveal = () =>
    start(async () => {
      setErr(undefined);
      const r = await revealAssociatePii(associateId, field);
      if (r.ok) setValue(r.value ?? "—");
      else setErr(r.error ?? t("detail.revealFailed"));
    });

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-2">{label}</div>
      <div className="mt-0.5 flex items-center gap-2 text-[13px] text-ink">
        {!hasValue ? (
          <span>—</span>
        ) : value != null ? (
          <>
            <span className="font-mono">{value}</span>
            <button type="button" onClick={() => setValue(null)} className="text-[12px] text-muted hover:text-ink">
              {t("detail.hide")}
            </button>
          </>
        ) : (
          <>
            <span className="tracking-[0.2em] text-muted-2">••••••</span>
            {canReveal && (
              <button type="button" onClick={reveal} disabled={pending} className="text-[12px] text-action hover:underline disabled:opacity-50">
                {pending ? "…" : t("detail.show")}
              </button>
            )}
          </>
        )}
        {err && <span className="text-[11px] text-danger">{err}</span>}
      </div>
    </div>
  );
}
