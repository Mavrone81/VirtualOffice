"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { runPayouts, approveAllPayouts, setPayoutStatus } from "@/server/payouts/actions";

export function RunPayoutsBar({ month }: { month: string }) {
  const t = useTranslations("payouts");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runPayouts(month);
            setMsg(r.ok ? t("aggregated", { count: r.count ?? 0 }) : r.error);
            router.refresh();
          })
        }
      >
        {pending ? t("running") : t("runPayouts")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => { await approveAllPayouts(month); router.refresh(); })}
      >
        {t("approveAll")}
      </Button>
      <a
        href={`/admin/payouts/bank-file?month=${month}`}
        className="inline-flex h-8 items-center rounded-lg border border-line bg-white px-3 text-[13px] text-ink hover:bg-paper-100"
      >
        {t("bankFile")}
      </a>
      {msg && <span className="text-[12px] text-muted">{msg}</span>}
    </div>
  );
}

export function PayoutRowActions({ id, status }: { id: string; status: string }) {
  const t = useTranslations("payouts");
  const [pending, start] = useTransition();
  const router = useRouter();
  if (status === "Paid" || status === "Cancelled") return null;
  return (
    <span className="flex gap-1">
      {status === "Pending" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { await setPayoutStatus(id, "Approved"); router.refresh(); })}>
          {t("approve")}
        </Button>
      )}
      {status === "Approved" && (
        <Button size="sm" disabled={pending} onClick={() => start(async () => { await setPayoutStatus(id, "Paid"); router.refresh(); })}>
          {t("markPaid")}
        </Button>
      )}
    </span>
  );
}
