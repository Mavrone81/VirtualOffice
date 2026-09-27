"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { approveSplitException } from "@/server/sales/actions";
import type { SplitBoundViolation } from "@/server/commission/split-bounds";

// B-S6: a Business Admin approves a split that books a negative commission line, with a
// reason. seenSplitEditedAt binds the approval to the split version this page rendered.
// seenLines: the negative lines this page showed; the server refuses if they changed (E1).
export function SplitExceptionForm({ id, seenSplitEditedAt, seenLines }: { id: string; seenSplitEditedAt: string | null; seenLines: SplitBoundViolation[] }) {
  const t = useTranslations("splitApprovals");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string>();

  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
      <textarea
        className="min-h-[38px] w-full flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[13px]"
        maxLength={500}
        placeholder={t("exceptionReasonPlaceholder")}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        size="sm"
        disabled={pending || reason.trim().length < 5}
        onClick={() =>
          start(async () => {
            setErr(undefined);
            const r = await approveSplitException(id, reason, seenSplitEditedAt, seenLines);
            if (r.ok) router.refresh();
            else setErr(r.error ?? t("failed"));
          })
        }
      >
        {pending ? "…" : t("exceptionApprove")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </div>
  );
}
