"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { adminApproveSplit } from "@/server/sales/actions";

// Business Admin signs off a commission split (23-Jul parallel workflow, flow A
// step 2). Idempotent server-side.
export function AdminApproveSplitButton({ id }: { id: string }) {
  const t = useTranslations("splitApprovals");
  const router = useRouter();
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
            const r = await adminApproveSplit(id);
            if (r.ok) router.refresh();
            else setErr(r.error ?? t("failed"));
          })
        }
      >
        {pending ? "…" : t("approve")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
