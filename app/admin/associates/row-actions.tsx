"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setApprovalStatus, setAssociateStatus } from "@/server/associates/actions";

export function AssociateRowActions({
  id,
  approval,
  status,
}: {
  id: string;
  approval: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const router = useRouter();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Failed");
      else router.refresh();
    });

  return (
    <span className="flex flex-wrap items-center gap-1">
      {approval === "Pending" && (
        <>
          <Button size="sm" disabled={pending} onClick={() => run(() => setApprovalStatus(id, "Approved"))}>
            Approve
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setApprovalStatus(id, "Rejected"))}>
            Reject
          </Button>
        </>
      )}
      {approval === "Approved" && status === "Active" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setAssociateStatus(id, "Suspended"))}>
          Suspend
        </Button>
      )}
      {approval === "Approved" && status === "Suspended" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setAssociateStatus(id, "Active"))}>
          Reactivate
        </Button>
      )}
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
