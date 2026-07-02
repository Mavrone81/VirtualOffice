"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resetAssociatePassword } from "@/server/account/actions";

export function ResetPasswordButton({ associateId }: { associateId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [temp, setTemp] = useState<string>();

  function reset() {
    setError(undefined);
    start(async () => {
      const r = await resetAssociatePassword(associateId);
      if (r.ok && r.tempPassword) setTemp(r.tempPassword);
      else setError(r.error ?? "Could not reset.");
    });
  }

  if (temp) {
    return (
      <div className="rounded-lg bg-success-50 px-3 py-2.5 text-[13px]">
        <div className="text-success">✓ New temporary password:</div>
        <div className="mt-1 font-mono text-ink">{temp}</div>
        <div className="mt-1 text-[11px] text-muted-2">Relay this to the associate — they can change it under Account.</div>
      </div>
    );
  }

  return (
    <div>
      <Button variant="secondary" size="sm" onClick={reset} disabled={pending}>
        {pending ? "Resetting…" : "Reset password"}
      </Button>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
