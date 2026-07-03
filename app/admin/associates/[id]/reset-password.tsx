"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { resetAssociatePassword } from "@/server/account/actions";

export function ResetPasswordButton({ associateId }: { associateId: string }) {
  const t = useTranslations("associates");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [temp, setTemp] = useState<string>();

  function reset() {
    setError(undefined);
    start(async () => {
      const r = await resetAssociatePassword(associateId);
      if (r.ok && r.tempPassword) setTemp(r.tempPassword);
      else setError(r.error ?? t("reset.couldNotReset"));
    });
  }

  if (temp) {
    return (
      <div className="rounded-lg bg-success-50 px-3 py-2.5 text-[13px]">
        <div className="text-success">{t("reset.newPassword")}</div>
        <div className="mt-1 font-mono text-ink">{temp}</div>
        <div className="mt-1 text-[11px] text-muted-2">{t("reset.relay")}</div>
      </div>
    );
  }

  return (
    <div>
      <Button variant="secondary" size="sm" onClick={reset} disabled={pending}>
        {pending ? t("reset.resetting") : t("reset.button")}
      </Button>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
