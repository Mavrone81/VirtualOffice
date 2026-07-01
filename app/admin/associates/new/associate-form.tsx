"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { createAssociate, type NewAssociateInput } from "@/server/associates/actions";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function AssociateForm({ uplines }: { uplines: { code: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [f, setF] = useState<NewAssociateInput>({ fullName: "", designation: "SalesConsultant" });
  const set = (patch: Partial<NewAssociateInput>) => setF((p) => ({ ...p, ...patch }));

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await createAssociate(f);
      if (r.ok) router.push("/admin/associates");
      else setError(r.error ?? "Could not create.");
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">Identity</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fn">Full name *</Label>
            <Input id="fn" value={f.fullName} onChange={(e) => set({ fullName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="bn">Business name</Label>
            <Input id="bn" value={f.businessName ?? ""} onChange={(e) => set({ businessName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="mob">Mobile</Label>
            <Input id="mob" value={f.mobileNumber ?? ""} onChange={(e) => set({ mobileNumber: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="em">Email (login)</Label>
            <Input id="em" type="email" value={f.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="nric">NRIC (encrypted)</Label>
            <Input id="nric" value={f.nric ?? ""} onChange={(e) => set({ nric: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="dob">Date of birth</Label>
            <Input id="dob" type="date" value={f.dateOfBirth ?? ""} onChange={(e) => set({ dateOfBirth: e.target.value })} />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">Role & hierarchy</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="des">Designation</Label>
            <select id="des" className={selectCls} value={f.designation} onChange={(e) => set({ designation: e.target.value as NewAssociateInput["designation"] })}>
              <option value="SalesConsultant">Sales Consultant</option>
              <option value="AssistantSalesManager">Assistant Sales Manager</option>
              <option value="SalesManager">Sales Manager</option>
              <option value="SalesDirector">Sales Director</option>
            </select>
          </div>
          <div>
            <Label htmlFor="up">Direct upline</Label>
            <select id="up" className={selectCls} value={f.directUplineCode ?? ""} onChange={(e) => set({ directUplineCode: e.target.value || undefined })}>
              <option value="">— None (division head) —</option>
              {uplines.map((u) => (
                <option key={u.code} value={u.code}>{u.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="team">Team / division</Label>
            <Input id="team" value={f.teamName ?? ""} onChange={(e) => set({ teamName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="rm">Recruiting manager</Label>
            <Input id="rm" value={f.recruitingManager ?? ""} onChange={(e) => set({ recruitingManager: e.target.value })} />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-display text-[17px] text-ink">Payment</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="pm">Payment method</Label>
            <select id="pm" className={selectCls} value={f.paymentMethod ?? "PayNow"} onChange={(e) => set({ paymentMethod: e.target.value as "PayNow" | "Bank Transfer" })}>
              <option value="PayNow">PayNow</option>
              <option value="Bank Transfer">Bank Transfer</option>
            </select>
          </div>
          <div>
            <Label htmlFor="pn">PayNow number</Label>
            <Input id="pn" value={f.paynowNumber ?? ""} onChange={(e) => set({ paynowNumber: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="bankn">Bank name</Label>
            <Input id="bankn" value={f.bankName ?? ""} onChange={(e) => set({ bankName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="bacct">Bank account (encrypted)</Label>
            <Input id="bacct" value={f.bankAccountNumber ?? ""} onChange={(e) => set({ bankAccountNumber: e.target.value })} />
          </div>
        </div>
      </Card>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={pending || !f.fullName}>
          {pending ? "Creating…" : "Create associate"}
        </Button>
        <span className="text-[12px] text-muted-2">Created as Pending / Inactive — approve to activate & provision login.</span>
      </div>
    </div>
  );
}
