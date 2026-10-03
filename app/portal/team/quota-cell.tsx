"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { setQuota } from "@/server/quota/actions";
import { sanitizeAmountInput } from "@/lib/numeric";

const fmt = (s: string) =>
  "$" + Number(s).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function QuotaCell({
  associateId,
  month,
  current,
  canEdit,
  inherited = false,
}: {
  associateId: string;
  month: string;
  current: string | null;
  canEdit: boolean;
  /** The shown figure is the team target; saving here creates an individual override. */
  inherited?: boolean;
}) {
  const t = useTranslations("team");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();

  const tag = inherited && current ? <span className="ml-1.5 text-[11px] text-muted">{t("overview.teamTargetTag")}</span> : null;

  if (!canEdit) return <span className="text-ink">{current ? fmt(current) : "—"}{tag}</span>;

  if (!editing) {
    return (
      <span>
        <button type="button" onClick={() => setEditing(true)} className="text-action hover:underline">
          {current ? fmt(current) : t("overview.setQuota")}
        </button>
        {tag}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => setValue(sanitizeAmountInput(e.target.value))}
        className="h-8 w-24"
        inputMode="decimal"
        placeholder="0"
        autoFocus
      />
      <button
        type="button"
        disabled={pending}
        className="text-[12px] font-medium text-action disabled:opacity-50"
        onClick={() =>
          start(async () => {
            setErr(undefined);
            const r = await setQuota({ associateId, month, amount: parseFloat(value) || 0 });
            if (r.ok) { setEditing(false); router.refresh(); } else setErr(r.error);
          })
        }
      >
        {pending ? "…" : t("overview.save")}
      </button>
      <button type="button" className="text-[12px] text-muted" onClick={() => { setEditing(false); setValue(current ?? ""); setErr(undefined); }}>
        ✕
      </button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
