"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { verifySubmission } from "@/server/sales/actions";

export function VerifyButton({ id }: { id: string }) {
  const t = useTranslations("sales");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await verifySubmission(id);
          if (!r.ok) setErr(r.error ?? t("verify.failed"));
        })}
      >
        {pending ? t("verify.verifying") : t("verify.button")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </div>
  );
}
