"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cancelInvite } from "@/server/recruitment/actions";

// Cancel a pending invite (Issues v1.0): deletes the record + invalidates the
// link. Two-step to avoid an accidental destructive click.
export function CancelInviteButton({ id }: { id: string }) {
  const t = useTranslations("recruitment");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string>();

  if (!confirming) {
    return <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>{t("invites.cancel")}</Button>;
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(undefined);
            const r = await cancelInvite(id);
            if (r.ok) router.refresh();
            else setErr(r.error ?? t("invites.cancelFailed"));
          })
        }
      >
        {pending ? "…" : t("invites.confirmCancel")}
      </Button>
      <button type="button" className="text-[12px] text-muted hover:underline" onClick={() => setConfirming(false)}>{t("invites.keep")}</button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
