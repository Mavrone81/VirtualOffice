"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { verifySubmission } from "@/server/sales/actions";

export function VerifyButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await verifySubmission(id);
          if (!r.ok) setErr(r.error ?? "Failed");
        })}
      >
        {pending ? "Verifying…" : "Verify"}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </div>
  );
}
