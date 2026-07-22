"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { revertSplitApproval } from "@/server/sales/actions";

// Revert a split approval (Issues v1.0) — allowed until the admin approves the
// quotation. Server-side gated + idempotent.
export function RevertSplitButton({ id }: { id: string }) {
  const t = useTranslations("portal");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(undefined);
            const r = await revertSplitApproval(id);
            if (r.ok) router.refresh();
            else setErr(r.error ?? t("approvals.revertFailed"));
          })
        }
      >
        {pending ? "…" : t("approvals.revert")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
