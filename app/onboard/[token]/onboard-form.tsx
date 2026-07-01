"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitOnboarding, type OnboardingSubmission } from "@/server/recruitment/actions";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function OnboardForm({ token, alreadySubmitted }: { token: string; alreadySubmitted: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [f, setF] = useState<OnboardingSubmission>({
    nric: "", paymentMethod: "PayNow", agreementAccepted: false,
  });
  const set = (patch: Partial<OnboardingSubmission>) => setF((p) => ({ ...p, ...patch }));

  function submit() {
    setError(undefined);
    if (!f.agreementAccepted) { setError("Please accept the Associate Agreement to continue."); return; }
    start(async () => {
      const r = await submitOnboarding(token, f);
      if (r.ok) setDone(true);
      else setError(r.error ?? "Could not submit. Please try again.");
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-line bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-50 text-2xl text-success">✓</div>
        <h2 className="font-display text-[20px] text-ink">Thank you — you&rsquo;re all set</h2>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted">
          Your details and signed agreement have been submitted to Enshrine for approval. Once approved, you&rsquo;ll
          receive your virtual-office login by email. You may close this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {alreadySubmitted && (
        <div className="rounded-lg bg-action-50 px-4 py-3 text-[13px] text-action">
          You&rsquo;ve already submitted this form. Submitting again will update your details.
        </div>
      )}

      <div className="rounded-xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[16px] text-ink">Your details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="bn">Business / trading name</Label>
            <Input id="bn" value={f.businessName ?? ""} onChange={(e) => set({ businessName: e.target.value })} placeholder="Optional" />
          </div>
          <div>
            <Label htmlFor="nric">NRIC / FIN *</Label>
            <Input id="nric" value={f.nric} onChange={(e) => set({ nric: e.target.value })} placeholder="SxxxxxxxA" />
          </div>
          <div>
            <Label htmlFor="dob">Date of birth</Label>
            <Input id="dob" type="date" value={f.dateOfBirth ?? ""} onChange={(e) => set({ dateOfBirth: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="addr">Residential address</Label>
            <Input id="addr" value={f.residentialAddress ?? ""} onChange={(e) => set({ residentialAddress: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ecn">Emergency contact name</Label>
            <Input id="ecn" value={f.emergencyContactName ?? ""} onChange={(e) => set({ emergencyContactName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ecp">Emergency contact number</Label>
            <Input id="ecp" value={f.emergencyContactNumber ?? ""} onChange={(e) => set({ emergencyContactNumber: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="photo">Profile photo</Label>
            <input
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => set({ photo: e.target.files?.[0] ?? null })}
              className="block w-full text-[13px] text-body file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-[13px] file:text-white hover:file:bg-ink-700"
            />
            <p className="mt-1 text-[12px] text-muted-2">Used on your name card and staff record. JPG, PNG or WebP, up to 5&nbsp;MB. Optional.</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[16px] text-ink">Commission payout</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="pm">Preferred method</Label>
            <select id="pm" className={selectCls} value={f.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as OnboardingSubmission["paymentMethod"] })}>
              <option value="PayNow">PayNow</option>
              <option value="Bank Transfer">Bank Transfer</option>
            </select>
          </div>
          {f.paymentMethod === "PayNow" ? (
            <div>
              <Label htmlFor="pn">PayNow number</Label>
              <Input id="pn" value={f.paynowNumber ?? ""} onChange={(e) => set({ paynowNumber: e.target.value })} placeholder="Mobile / NRIC-linked" />
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="bank">Bank name</Label>
                <Input id="bank" value={f.bankName ?? ""} onChange={(e) => set({ bankName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="acc">Bank account number</Label>
                <Input id="acc" value={f.bankAccountNumber ?? ""} onChange={(e) => set({ bankAccountNumber: e.target.value })} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-[16px] text-ink">Associate Agreement</h2>
        <div className="max-h-44 overflow-y-auto rounded-lg border border-line bg-paper-100 p-4 text-[12px] leading-relaxed text-muted">
          <p>
            This Associate Agreement is entered into between Enshrine and the individual named in this onboarding. As an
            independent commission-based associate, you agree to represent Enshrine&rsquo;s services with integrity, to
            comply with all applicable regulations, and to the commission structure and payout terms communicated to you.
          </p>
          <p className="mt-2">
            Commissions are earned on verified, collected sales and are subject to the override and eligibility rules of
            the Enshrine commission plan. Personal data provided here is used solely for HR, payout, and compliance
            purposes and is stored securely. This is a summary; the full agreement will be provided in your P-file.
          </p>
        </div>
        <label className="mt-4 flex items-start gap-2.5 text-[13px] text-body">
          <input type="checkbox" className="mt-0.5" checked={f.agreementAccepted} onChange={(e) => set({ agreementAccepted: e.target.checked })} />
          <span>I have read and accept the Associate Agreement, and confirm the details above are accurate.</span>
        </label>
      </div>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <Button onClick={submit} disabled={pending || !f.nric || !f.agreementAccepted} className="w-full sm:w-auto">
        {pending ? "Submitting…" : "Submit & sign"}
      </Button>
    </div>
  );
}
