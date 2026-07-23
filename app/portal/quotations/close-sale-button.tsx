"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { closeSale } from "@/server/sales/actions";

// The closing associate closes a sale once the quotation is signed and the split
// is fully approved (23-Jul parallel workflow, issue 4). Disabled with a reason
// until a signed document is in the docket.
export function CloseSaleButton({ id, ready, reason }: { id: string; ready: boolean; reason: string }) {
  const t = useTranslations("quotations");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending || !ready}
        title={ready ? undefined : reason}
        onClick={() =>
          start(async () => {
            setErr(undefined);
            const r = await closeSale(id);
            if (r.ok) router.refresh();
            else setErr(r.error ?? t("detail.failed"));
          })
        }
      >
        {pending ? "…" : t("closeSale")}
      </Button>
      {!ready && !err && <span className="text-[11px] text-muted">{reason}</span>}
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
