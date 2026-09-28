"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner } from "@/components/ui/banner";
import { rejectSubmission } from "@/server/sales/actions";

// A-17 screen 4: reject needs a reason, same "type a reason" pattern as
// split-exception approval and B-7's un-mark-paid (one shared idiom, not a
// new widget). Verify's own checklist/button lands in a follow-up commit
// once Backend's read-only G1-G5 checklist helper is ready.
export function RejectButton({ id }: { id: string }) {
  const t = useTranslations("verify");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string>();

  function confirm() {
    if (!reason.trim()) return;
    setErr(undefined);
    start(async () => {
      const r = await rejectSubmission(id, reason);
      if (r.ok) { setDialog(false); router.refresh(); }
      else setErr(r.error ?? t("reject"));
    });
  }

  if (!dialog) {
    return <Button size="sm" variant="ghost" onClick={() => setDialog(true)}>{t("reject")}</Button>;
  }

  return (
    <div className="inline-flex flex-col gap-2 rounded-lg border border-line bg-paper-100 p-3 text-[12px]">
      <Label htmlFor={`reject-reason-${id}`} className="mb-0 text-[12px]">{t("reasonRequired")}</Label>
      <Input id={`reject-reason-${id}`} className="h-8 text-[12px]" value={reason} onChange={(e) => setReason(e.target.value)} />
      {err && <Banner tone="danger">{err}</Banner>}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="danger" disabled={!reason.trim() || pending} onClick={confirm}>
          {pending ? "…" : t("rejectConfirm")}
        </Button>
        <button type="button" className="text-muted hover:underline" onClick={() => setDialog(false)}>{t("cancel")}</button>
      </div>
    </div>
  );
}
