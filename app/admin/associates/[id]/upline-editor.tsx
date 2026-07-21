"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateAssociateUplines } from "@/server/associates/actions";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

// Admin-only editor for an associate's direct + second upline (16-Jul §7).
// Overrides are positional (direct = Tier 1, second = Tier 2), so both are
// settable. Changing them affects future verifications only.
export function UplineEditor({
  associateId,
  choices,
  initialDirect,
  initialSecond,
}: {
  associateId: string;
  choices: { code: string; label: string }[];
  initialDirect: string | null;
  initialSecond: string | null;
}) {
  const t = useTranslations("associates");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [direct, setDirect] = useState(initialDirect ?? "");
  const [second, setSecond] = useState(initialSecond ?? "");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const dirty = direct !== (initialDirect ?? "") || second !== (initialSecond ?? "");

  function save() {
    setError(undefined);
    setSaved(false);
    start(async () => {
      const r = await updateAssociateUplines(associateId, direct || null, second || null);
      if (r.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 2500);
      } else {
        setError(r.error ?? tc("save"));
      }
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="ed-direct">{t("detail.directUpline")}</Label>
        <select id="ed-direct" className={selectCls} value={direct} onChange={(e) => setDirect(e.target.value)}>
          <option value="">{t("form.noneHead")}</option>
          {choices.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="ed-second">{t("detail.secondUpline")}</Label>
        <select id="ed-second" className={selectCls} value={second} onChange={(e) => setSecond(e.target.value)}>
          <option value="">{t("form.noneHead")}</option>
          {choices.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <p className="mb-2 text-[12px] text-muted-2">{t("detail.uplineEditHint")}</p>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? tc("saving") : tc("save")}
          </Button>
          {saved && <span className="text-[12px] text-success">{tc("saved")}</span>}
          {error && <span className="text-[12px] text-danger">{error}</span>}
        </div>
      </div>
    </div>
  );
}
