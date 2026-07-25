"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { reassignSplitDirector } from "@/server/sales/actions";

// Admin reassigns a submission's split Sales Director (23-Jul, issue 2 add-on).
// Only offered while the SD step is still open; changing the dropdown reassigns.
export function ReassignDirector({ submissionId, current, directors }: { submissionId: string; current: string | null; directors: { id: string; name: string }[] }) {
  const t = useTranslations("splitApprovals");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const [val, setVal] = useState(current ?? "");

  return (
    <span className="inline-flex items-center gap-1.5">
      <label className="text-[11px] text-muted">{t("director")}</label>
      <select
        className="h-8 rounded-lg border border-line bg-white px-2 text-[12px] text-ink disabled:opacity-50"
        value={val}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          const prev = val;
          setVal(v);
          start(async () => {
            setErr(undefined);
            const r = await reassignSplitDirector(submissionId, v || null);
            if (r.ok) router.refresh();
            else { setErr(r.error ?? t("failed")); setVal(prev); }
          });
        }}
      >
        <option value="">{t("noDirector")}</option>
        {directors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </span>
  );
}
