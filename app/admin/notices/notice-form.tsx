"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { createNotice, type NoticeInput } from "@/server/notices/actions";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function NoticeForm() {
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
      else setError(r.error ?? "Could not publish.");
    });
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-display text-[17px] text-ink">Publish a notice</h2>
      <div className="space-y-4">
        <div>
          <Label htmlFor="t">Title *</Label>
          <Input id="t" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. June commission run complete" />
        </div>
        <div>
          <Label htmlFor="b">Message *</Label>
          <textarea id="b" value={f.body} onChange={(e) => set({ body: e.target.value })} rows={4}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-action focus:outline-none" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="a">Audience</Label>
            <select id="a" className={selectCls} value={f.audience} onChange={(e) => set({ audience: e.target.value as NoticeInput["audience"] })}>
              <option value="All">Everyone</option>
              <option value="Team">A team</option>
              <option value="Role">A role</option>
            </select>
          </div>
          {f.audience === "Team" && (
            <div>
              <Label htmlFor="tm">Team name</Label>
              <Input id="tm" value={f.audienceTeam ?? ""} onChange={(e) => set({ audienceTeam: e.target.value })} />
            </div>
          )}
          {f.audience === "Role" && (
            <div>
              <Label htmlFor="r">Role</Label>
              <select id="r" className={selectCls} value={f.audienceRole ?? "Consultant"} onChange={(e) => set({ audienceRole: e.target.value as NoticeInput["audienceRole"] })}>
                <option value="Consultant">Consultant</option>
                <option value="SalesManager">Sales Manager</option>
                <option value="SalesDirector">Sales Director</option>
              </select>
            </div>
          )}
        </div>
        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button onClick={submit} disabled={pending || !f.title || !f.body}>{pending ? "Publishing…" : "Publish notice"}</Button>
      </div>
    </Card>
  );
}
