"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { inviteCandidate, type InviteInput } from "@/server/recruitment/actions";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function InviteForm({
  uplines,
  baseUrl,
}: {
  uplines: { code: string; label: string }[];
  baseUrl: string;
}) {
  const t = useTranslations("recruitment");
  const tc = useTranslations("common");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [link, setLink] = useState<string>();
  const [emailed, setEmailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [f, setF] = useState<InviteInput>({
    fullName: "", mobileNumber: "", email: "", intendedDesignation: "SalesAssociate",
  });
  const set = (patch: Partial<InviteInput>) => setF((p) => ({ ...p, ...patch }));

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await inviteCandidate(f);
      if (r.ok && r.token) { setLink(`${baseUrl}/onboard/${r.token}`); setEmailed(!!r.emailed); }
      else setError(r.error ?? t("form.couldNotInvite"));
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  if (link) {
    return (
      <div className="max-w-2xl space-y-5">
        <Card className="p-6">
          <div className="mb-1 text-[13px] font-medium text-success">{t("form.inviteCreated", { name: f.fullName })}</div>
          <p className="text-[13px] text-muted">
            {emailed
              ? t("form.emailedLink", { email: f.email })
              : t("form.manualLink")}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <input readOnly value={link} className={`${selectCls} font-mono text-[12px] text-body`} onFocus={(e) => e.target.select()} />
            <Button type="button" variant="secondary" onClick={copy}>{copied ? t("form.copiedCheck") : t("form.copy")}</Button>
          </div>
        </Card>
        <div className="flex gap-2">
          <Button asChild><Link href="/admin/recruitment">{t("form.backToPipeline")}</Link></Button>
          <Button variant="secondary" onClick={() => { setLink(undefined); setF({ fullName: "", mobileNumber: "", email: "", intendedDesignation: "SalesAssociate" }); }}>
            {t("form.inviteAnother")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">{t("form.candidateSection")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fn">{t("form.fullName")}</Label>
            <Input id="fn" value={f.fullName} onChange={(e) => set({ fullName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="em">{t("form.email")}</Label>
            <Input id="em" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="mob">{t("form.mobile")}</Label>
            <Input id="mob" value={f.mobileNumber} onChange={(e) => set({ mobileNumber: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="team">{t("form.intendedTeam")}</Label>
            <Input id="team" value={f.intendedTeam ?? ""} onChange={(e) => set({ intendedTeam: e.target.value })} placeholder="e.g. Team Grace" />
          </div>
          <div>
            <Label htmlFor="des">{t("form.intendedDesignation")}</Label>
            <select id="des" className={selectCls} value={f.intendedDesignation} onChange={(e) => set({ intendedDesignation: e.target.value as InviteInput["intendedDesignation"] })}>
              <option value="SalesAssociate">{t("form.desSalesAssociate")}</option>
              <option value="SalesAssistantManager">{t("form.desAsmgr")}</option>
              <option value="SalesManager">{t("form.desSalesMgr")}</option>
              <option value="SalesDirector">{t("form.desSalesDir")}</option>
            </select>
          </div>
          <div>
            <Label htmlFor="up">{t("form.directUpline")}</Label>
            <select id="up" className={selectCls} value={f.intendedDirectUplineCode ?? ""} onChange={(e) => set({ intendedDirectUplineCode: e.target.value || undefined })}>
              <option value="">{t("form.noneOption")}</option>
              {uplines.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <Button onClick={submit} disabled={pending || !f.fullName || !f.email || !f.mobileNumber}>
        {pending ? tc("creating") : t("form.createInviteLink")}
      </Button>
    </div>
  );
}
