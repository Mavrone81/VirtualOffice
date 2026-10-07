"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { inviteCandidate, type InviteInput } from "@/server/recruitment/actions";
import { DESIGNATION_OPTIONS } from "@/lib/roles";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function InviteForm({
  uplines,
  baseUrl,
  teamOptions,
  isAdmin,
  backHref,
}: {
  uplines: { code: string; label: string }[];
  baseUrl: string;
  /** Business Admin: every active team (empty falls back to free text, e.g. before
   *  any team exists). Manager / Director: their OWN team(s) — never a free choice. */
  teamOptions?: string[];
  /** The team control is Business Admin only (owner ruling, Oct 2026: admin
   *  uploads/invites apply to all teams, a director's to their own team). A
   *  non-admin invites into their own team, which is implied; with exactly one
   *  it is shown read-only, with several they must name which, with none there
   *  is no team. The server enforces the same rule — this is presentation. */
  isAdmin: boolean;
  /** Where "Back to pipeline" goes; omitted when the page itself is the pipeline view. */
  backHref?: string;
}) {
  const t = useTranslations("recruitment");
  const tc = useTranslations("common");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [link, setLink] = useState<string>();
  const [emailed, setEmailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const ownTeams = !isAdmin ? (teamOptions ?? []) : [];
  const blank = (): InviteInput => ({
    fullName: "", mobileNumber: "", email: "", intendedDesignation: "SalesAssociate", commencementDate: "",
  });
  const [f, setF] = useState<InviteInput>(blank);
  const set = (patch: Partial<InviteInput>) => setF((p) => ({ ...p, ...patch }));

  // Non-admin: the team is implied (never sent for 0 or 1 teams); with several
  // the caller must name one. Admin: whatever the dropdown says.
  const needsTeamPick = !isAdmin && ownTeams.length > 1 && !f.intendedTeam;

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
          {backHref && <Button asChild><Link href={backHref}>{t("form.backToPipeline")}</Link></Button>}
          <Button variant="secondary" onClick={() => { setLink(undefined); setF(blank()); }}>
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
          {isAdmin ? (
            <div>
              <Label htmlFor="team">{t("form.intendedTeam")}</Label>
              {teamOptions && teamOptions.length > 0 ? (
                <select id="team" className={selectCls} value={f.intendedTeam ?? ""} onChange={(e) => set({ intendedTeam: e.target.value })}>
                  <option value="">{t("form.pickTeam")}</option>
                  {teamOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <Input id="team" value={f.intendedTeam ?? ""} onChange={(e) => set({ intendedTeam: e.target.value })} placeholder={t("form.teamPlaceholder")} />
              )}
            </div>
          ) : ownTeams.length === 1 ? (
            <div>
              <Label>{t("form.intendedTeam")}</Label>
              <p className="flex h-11 items-center text-sm text-body">{t("form.impliedTeam", { team: ownTeams[0] })}</p>
            </div>
          ) : ownTeams.length > 1 ? (
            <div>
              <Label htmlFor="team">{t("form.pickOwnTeam")}</Label>
              <select id="team" className={selectCls} value={f.intendedTeam ?? ""} onChange={(e) => set({ intendedTeam: e.target.value || undefined })}>
                <option value="">{t("form.pickTeam")}</option>
                {ownTeams.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <Label htmlFor="des">{t("form.intendedDesignation")}</Label>
            <select id="des" className={selectCls} value={f.intendedDesignation} onChange={(e) => set({ intendedDesignation: e.target.value as InviteInput["intendedDesignation"] })}>
              {DESIGNATION_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{t(d.labelKey)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="commence">{t("form.commencementDate")}</Label>
            <Input id="commence" type="date" required value={f.commencementDate} onChange={(e) => set({ commencementDate: e.target.value })} />
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
      <Button onClick={submit} disabled={pending || needsTeamPick || !f.fullName || !f.email || !f.mobileNumber || !f.commencementDate}>
        {pending ? tc("creating") : t("form.createInviteLink")}
      </Button>
    </div>
  );
}
