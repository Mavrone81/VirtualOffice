"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { createNotice, type NoticeInput } from "@/server/notices/actions";
import { useTranslations } from "next-intl";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function NoticeForm() {
  const t = useTranslations("notices");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [f, setF] = useState<NoticeInput>({ title: "", body: "", audience: "All" });
  const set = (patch: Partial<NoticeInput>) => setF((p) => ({ ...p, ...patch }));

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await createNotice(f);
      if (r.ok) { setF({ title: "", body: "", audience: "All" }); router.refresh(); }
      else setError(r.error ?? t("form.errorDefault"));
    });
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-display text-[17px] text-ink">{t("form.heading")}</h2>
      <div className="space-y-4">
        <div>
          <Label htmlFor="t">{t("form.titleLabel")}</Label>
          <Input id="t" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. June commission run complete" />
        </div>
        <div>
          <Label htmlFor="b">{t("form.messageLabel")}</Label>
          <textarea id="b" value={f.body} onChange={(e) => set({ body: e.target.value })} rows={4}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-action focus:outline-none" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="a">{t("form.audienceLabel")}</Label>
            <select id="a" className={selectCls} value={f.audience} onChange={(e) => set({ audience: e.target.value as NoticeInput["audience"] })}>
              <option value="All">{t("form.audienceAll")}</option>
              <option value="Team">{t("form.audienceTeam")}</option>
              <option value="Role">{t("form.audienceRole")}</option>
            </select>
          </div>
          {f.audience === "Team" && (
            <div>
              <Label htmlFor="tm">{t("form.teamNameLabel")}</Label>
              <Input id="tm" value={f.audienceTeam ?? ""} onChange={(e) => set({ audienceTeam: e.target.value })} />
            </div>
          )}
          {f.audience === "Role" && (
            <div>
              <Label htmlFor="r">{t("form.roleLabel")}</Label>
              <select id="r" className={selectCls} value={f.audienceRole ?? "SalesAssociate"} onChange={(e) => set({ audienceRole: e.target.value as NoticeInput["audienceRole"] })}>
                <option value="SalesAssociate">{t("form.roleConsultant")}</option>
                <option value="SalesManager">{t("form.roleSalesManager")}</option>
                <option value="SalesDirector">{t("form.roleSalesDirector")}</option>
              </select>
            </div>
          )}
        </div>
        <div>
          <Label htmlFor="att">{t("form.attachmentLabel")}</Label>
          <input id="att" type="file" onChange={(e) => set({ attachment: e.target.files?.[0] ?? null })}
            className="block w-full text-[13px] text-body file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-[13px] file:text-white hover:file:bg-ink-700" />
          <p className="mt-1 text-[12px] text-muted-2">{t("form.attachmentHint")}</p>
        </div>
        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button onClick={submit} disabled={pending || !f.title || !f.body}>{pending ? t("form.submitting") : t("form.submit")}</Button>
      </div>
    </Card>
  );
}
