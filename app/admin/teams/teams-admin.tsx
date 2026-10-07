"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { setTeamQuota, clearTeamQuota, setIndividualQuota, clearIndividualQuota } from "@/server/quota/team-actions";
import { sanitizeAmountInput } from "@/lib/numeric";
import { createTeam, addTeamMember, removeTeamMember, setTeamDirector } from "@/server/teams/actions";

type Assoc = { id: string; name: string; designation: string; monthlyTarget: string | null; yearlyTarget: string | null };
type Team = { id: string; name: string; directorId: string | null; memberIds: string[]; monthlyTarget: string | null; yearlyTarget: string | null };

const selectCls = "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function TeamsAdmin({ teams, associates, month, year }: { teams: Team[]; associates: Assoc[]; month: string; year: string }) {
  const t = useTranslations("teams");
  const router = useRouter();
  const nameById = new Map(associates.map((a) => [a.id, a.name]));
  const directors = associates.filter((a) => a.designation === "SalesDirector");
  // Membership, not the director field: heading a team is a separate
  // relationship and does not put someone in the member list.
  const inSomeTeam = new Set(teams.flatMap((tm) => tm.memberIds));
  const unassigned = associates.filter((a) => !inSomeTeam.has(a.id));
  const [name, setName] = useState("");
  const [directorId, setDirectorId] = useState("");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">{t("createHeading")}</h2>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="tn">{t("nameLabel")}</Label>
            <Input id="tn" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
          </div>
          <div>
            <Label htmlFor="td">{t("directorLabel")}</Label>
            <select id="td" className={selectCls} value={directorId} onChange={(e) => setDirectorId(e.target.value)}>
              <option value="">{t("noDirector")}</option>
              {directors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <Button
            disabled={pending || !name.trim()}
            onClick={() => start(async () => {
              setErr(undefined);
              const r = await createTeam({ name, directorId: directorId || undefined });
              if (r.ok) { setName(""); setDirectorId(""); router.refresh(); } else setErr(r.error);
            })}
          >
            {t("createBtn")}
          </Button>
        </div>
        {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      </Card>

      {teams.length === 0 ? (
        <p className="text-[13px] text-muted">{t("empty")}</p>
      ) : (
        teams.map((team) => <TeamCard key={team.id} team={team} associates={associates} nameById={nameById} month={month} year={year} />)
      )}

      {/* Individual targets moved INTO each team card above (owner, 2026-10-07),
          so a member is edited next to the team whose target they override
          rather than hunted for in one long list at the foot of the page.

          This card is what is left over, and it is not cosmetic: team
          membership is optional, so without it every associate who belongs to
          no team would have no individual target editor anywhere on the site.
          A director counts here too — directorId is a separate field from
          members, so heading a team does not make someone a member of it. */}
      {unassigned.length > 0 && (
        <Card className="p-5">
          <h2 className="font-display text-[17px] text-ink">{t("individualTargetsUnassignedHeading")}</h2>
          <p className="mt-1 text-[12px] text-muted">{t("individualTargetsNote")}</p>
          <div className="mt-4 space-y-4">
            {unassigned.map((a) => (
              <div key={a.id} className="grid gap-3 border-b border-line pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <span className="text-[13px] text-ink">{a.name}</span>
                <IndividualTargetEditor associateId={a.id} month={month} label={t("monthlyTarget", { period: month })} current={a.monthlyTarget} />
                <IndividualTargetEditor associateId={a.id} month={year} label={t("yearlyTarget", { period: year })} current={a.yearlyTarget} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function IndividualTargetEditor({ associateId, month, label, current }: {
  associateId: string; month: string; label: string; current: string | null;
}) {
  const t = useTranslations("teams");
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const dirty = value !== (current ?? "");

  return (
    <div>
      <Label htmlFor={`iq-${associateId}-${month}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`iq-${associateId}-${month}`}
          value={value}
          onChange={(e) => setValue(sanitizeAmountInput(e.target.value))}
          inputMode="decimal"
          placeholder={t("targetNotSet")}
          className="h-9 w-36"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !dirty || !(parseFloat(value) > 0)}
          onClick={() => start(async () => {
            setErr(undefined);
            const r = await setIndividualQuota({ associateId, month, amount: parseFloat(value) });
            if (r.ok) router.refresh(); else setErr(r.error);
          })}
        >
          {t("saveTarget")}
        </Button>
        {current !== null && (
          <button
            type="button"
            disabled={pending}
            className="text-[12px] text-muted hover:text-danger"
            onClick={() => start(async () => {
              setErr(undefined);
              const r = await clearIndividualQuota({ associateId, month });
              if (r.ok) { setValue(""); router.refresh(); } else setErr(r.error);
            })}
          >
            {t("clearTarget")}
          </button>
        )}
      </div>
      {err && <p className="mt-1 text-[11px] text-danger">{err}</p>}
    </div>
  );
}

function TeamCard({ team, associates, nameById, month, year }: { team: Team; associates: Assoc[]; nameById: Map<string, string>; month: string; year: string }) {
  const t = useTranslations("teams");
  const router = useRouter();
  const [addId, setAddId] = useState("");
  const [pending, start] = useTransition();
  const available = associates.filter((a) => !team.memberIds.includes(a.id));
  // Members in the team's own order, dropping any id with no matching
  // associate — the associate query filters to active, approved and
  // unarchived, so a membership row can outlive the person it points at.
  const members = team.memberIds
    .map((mid) => associates.find((a) => a.id === mid))
    .filter((a): a is Assoc => a !== undefined);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-[16px] text-ink">{team.name}</h3>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[12px] text-muted">{t("director")}:</span>
            <select
              className="h-8 rounded-lg border border-line bg-white px-2 text-[12px] text-ink"
              value={team.directorId ?? ""}
              disabled={pending}
              onChange={(e) => start(async () => { await setTeamDirector({ teamId: team.id, directorId: e.target.value || null }); router.refresh(); })}
            >
              <option value="">{t("noDirector")}</option>
              {associates.filter((a) => a.designation === "SalesDirector").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <span className="text-[12px] text-muted">{t("memberCount", { count: team.memberIds.length })}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {team.memberIds.length === 0 ? (
          <span className="text-[12px] text-muted-2">{t("noMembers")}</span>
        ) : team.memberIds.map((mid) => (
          <span key={mid} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-100 px-2.5 py-1 text-[12px] text-ink">
            {nameById.get(mid) ?? mid}
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => { await removeTeamMember({ teamId: team.id, associateId: mid }); router.refresh(); })}
              className="text-muted hover:text-danger"
              aria-label={t("remove")}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <select className="h-9 max-w-xs rounded-lg border border-line bg-white px-3 text-sm text-ink" value={addId} onChange={(e) => setAddId(e.target.value)}>
          <option value="">{t("addMember")}</option>
          {available.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !addId}
          onClick={() => start(async () => { await addTeamMember({ teamId: team.id, associateId: addId }); setAddId(""); router.refresh(); })}
        >
          {t("add")}
        </Button>
      </div>
      <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <TargetEditor teamId={team.id} periodType="Monthly" period={month} label={t("monthlyTarget", { period: month })} current={team.monthlyTarget} />
        <TargetEditor teamId={team.id} periodType="Yearly" period={year} label={t("yearlyTarget", { period: year })} current={team.yearlyTarget} />
      </div>
      <p className="mt-2 text-[11px] text-muted">{t("targetNote")}</p>

      {/* Each member's own override, directly under the team target it
          overrides (owner, 2026-10-07). Driven off `members`, the same list the
          chips above render, so the two cannot disagree about who is on the
          team. An associate on two teams is editable from either card and both
          write the same per-associate row — router.refresh() re-renders the
          whole page, so the other card cannot be left showing a stale value. */}
      {members.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <h4 className="text-[12px] font-medium uppercase tracking-[0.1em] text-muted">{t("individualTargetsHeading")}</h4>
          <p className="mt-1 text-[11px] text-muted">{t("individualTargetsNote")}</p>
          <div className="mt-3 space-y-4">
            {members.map((a) => (
              <div key={a.id} className="grid gap-3 border-b border-line pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <span className="text-[13px] text-ink">{a.name}</span>
                <IndividualTargetEditor associateId={a.id} month={month} label={t("monthlyTarget", { period: month })} current={a.monthlyTarget} />
                <IndividualTargetEditor associateId={a.id} month={year} label={t("yearlyTarget", { period: year })} current={a.yearlyTarget} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function TargetEditor({ teamId, periodType, period, label, current }: {
  teamId: string; periodType: "Monthly" | "Yearly"; period: string; label: string; current: string | null;
}) {
  const t = useTranslations("teams");
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const dirty = value !== (current ?? "");

  return (
    <div>
      <Label htmlFor={`tq-${teamId}-${periodType}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`tq-${teamId}-${periodType}`}
          value={value}
          onChange={(e) => setValue(sanitizeAmountInput(e.target.value))}
          inputMode="decimal"
          placeholder={t("targetNotSet")}
          className="h-9 w-36"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !dirty || !(parseFloat(value) > 0)}
          onClick={() => start(async () => {
            setErr(undefined);
            const r = await setTeamQuota({ teamId, periodType, period, amount: parseFloat(value) });
            if (r.ok) router.refresh(); else setErr(r.error);
          })}
        >
          {t("saveTarget")}
        </Button>
        {current !== null && (
          <button
            type="button"
            disabled={pending}
            className="text-[12px] text-muted hover:text-danger"
            onClick={() => start(async () => {
              setErr(undefined);
              const r = await clearTeamQuota({ teamId, periodType, period });
              if (r.ok) { setValue(""); router.refresh(); } else setErr(r.error);
            })}
          >
            {t("clearTarget")}
          </button>
        )}
      </div>
      {err && <p className="mt-1 text-[11px] text-danger">{err}</p>}
    </div>
  );
}
