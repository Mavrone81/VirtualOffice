"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { approveCandidate, rejectCandidate } from "@/server/recruitment/actions";

export function ReviewActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function approve() {
    setError(undefined);
    start(async () => {
      const r = await approveCandidate(id);
      if (r.ok) router.push("/admin/associates");
      else setError(r.error ?? "Could not approve.");
    });
  }

  function reject() {
    setError(undefined);
    start(async () => {
      const r = await rejectCandidate(id, reason);
      if (r.ok) { setRejecting(false); router.refresh(); }
      else setError(r.error ?? "Could not reject.");
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      {rejecting ? (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for rejection (optional)"
            rows={3}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-action focus:outline-none"
          />
          <div className="flex gap-2">
            <Button variant="danger" onClick={reject} disabled={pending}>{pending ? "Rejecting…" : "Confirm reject"}</Button>
            <Button variant="secondary" onClick={() => setRejecting(false)} disabled={pending}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button onClick={approve} disabled={pending}>{pending ? "Approving…" : "Approve → create associate"}</Button>
          <Button variant="secondary" onClick={() => setRejecting(true)} disabled={pending}>Reject</Button>
        </div>
      )}
    </div>
  );
}
