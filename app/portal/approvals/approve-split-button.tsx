"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { approveSubmissionSplit } from "@/server/sales/actions";

// SD approves a submission's share-com split (16-Jul §4). Idempotent server-side.
export function ApproveSplitButton({ id }: { id: string }) {
  const t = useTranslations("portal");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(undefined);
            const r = await approveSubmissionSplit(id);
            if (!r.ok) setErr(r.error ?? t("approvals.failed"));
          })
        }
      >
        {pending ? "…" : t("approvals.approve")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
