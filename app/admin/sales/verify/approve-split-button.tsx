"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { approveSubmissionSplit } from "@/server/sales/actions";

export function ApproveSplitButton({ id }: { id: string }) {
  const t = useTranslations("sales");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await approveSubmissionSplit(id);
            if (r.ok) router.refresh();
            else setErr(r.error ?? t("verify.failed"));
          })
        }
      >
        {pending ? "…" : t("verify.approveSplit")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
