"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitOnboarding, type OnboardingSubmission } from "@/server/recruitment/actions";
import { SignaturePad } from "./signature-pad";

const selectCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink focus:border-action focus:outline-none";

export function OnboardForm({ token, alreadySubmitted }: { token: string; alreadySubmitted: boolean }) {
  const t = useTranslations("onboarding");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [f, setF] = useState<OnboardingSubmission>({
    nric: "", paymentMethod: "PayNow", agreementAccepted: false,
  });
  const set = (patch: Partial<OnboardingSubmission>) => setF((p) => ({ ...p, ...patch }));

  function submit() {
    setError(undefined);
    if (!f.agreementAccepted) { setError(t("errors.noAgreement")); return; }
    if (!f.signature) { setError(t("errors.noSignature")); return; }
    start(async () => {
      const r = await submitOnboarding(token, f);
      if (r.ok) setDone(true);
      else setError(r.error ?? t("errors.submitFailed"));
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-line bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-50 text-2xl text-success">✓</div>
        <h2 className="font-display text-[20px] text-ink">{t("success.title")}</h2>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted">
          {t("success.body")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {alreadySubmitted && (
        <div className="rounded-lg bg-action-50 px-4 py-3 text-[13px] text-action">
          {t("resubmitBanner")}
        </div>
      )}

      <div className="rounded-xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[16px] text-ink">{t("details.title")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="bn">{t("details.businessName")}</Label>
            <Input id="bn" value={f.businessName ?? ""} onChange={(e) => set({ businessName: e.target.value })} placeholder={t("details.businessNamePlaceholder")} />
          </div>
          <div>
            <Label htmlFor="nric">{t("details.nric")}</Label>
            <Input id="nric" value={f.nric} onChange={(e) => set({ nric: e.target.value })} placeholder="SxxxxxxxA" />
          </div>
          <div>
            <Label htmlFor="dob">{t("details.dob")}</Label>
            <Input id="dob" type="date" value={f.dateOfBirth ?? ""} onChange={(e) => set({ dateOfBirth: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="marital">{t("details.maritalStatus")}</Label>
            <select
              id="marital"
              className={selectCls}
              value={f.maritalStatus ?? ""}
              onChange={(e) => set({ maritalStatus: (e.target.value || undefined) as OnboardingSubmission["maritalStatus"] })}
            >
              <option value="">—</option>
              <option value="Single">{t("details.single")}</option>
              <option value="Married">{t("details.married")}</option>
              <option value="Divorced">{t("details.divorced")}</option>
              <option value="Widowed">{t("details.widowed")}</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="addr">{t("details.address")}</Label>
            <Input id="addr" value={f.residentialAddress ?? ""} onChange={(e) => set({ residentialAddress: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ecn">{t("details.ecName")}</Label>
            <Input id="ecn" value={f.emergencyContactName ?? ""} onChange={(e) => set({ emergencyContactName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ecp">{t("details.ecNumber")}</Label>
            <Input id="ecp" value={f.emergencyContactNumber ?? ""} onChange={(e) => set({ emergencyContactNumber: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="spouseConflict">{t("details.spouseConflict")}</Label>
            <select
              id="spouseConflict"
              className={selectCls}
              value={f.spouseConflict ? "yes" : "no"}
              onChange={(e) => set({ spouseConflict: e.target.value === "yes" })}
            >
              <option value="no">{t("details.conflictNo")}</option>
              <option value="yes">{t("details.conflictYes")}</option>
            </select>
            <p className="mt-1 text-[12px] text-muted-2">{t("details.spouseConflictHint")}</p>
          </div>
          {f.spouseConflict && (
            <>
              <div>
                <Label htmlFor="spouseName">{t("details.spouseName")}</Label>
                <Input id="spouseName" value={f.spouseName ?? ""} onChange={(e) => set({ spouseName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="spouseCompany">{t("details.spouseCompany")}</Label>
                <Input id="spouseCompany" value={f.spouseCompany ?? ""} onChange={(e) => set({ spouseCompany: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="spouseDesignation">{t("details.spouseDesignation")}</Label>
                <Input id="spouseDesignation" value={f.spouseDesignation ?? ""} onChange={(e) => set({ spouseDesignation: e.target.value })} />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="photo">{t("details.photo")}</Label>
            <input
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => set({ photo: e.target.files?.[0] ?? null })}
              className="block w-full text-[13px] text-body file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-[13px] file:text-white hover:file:bg-ink-700"
            />
            <p className="mt-1 text-[12px] text-muted-2">{t("details.photoHint")}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-[16px] text-ink">{t("payout.title")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="pm">{t("payout.method")}</Label>
            <select id="pm" className={selectCls} value={f.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as OnboardingSubmission["paymentMethod"] })}>
              <option value="PayNow">PayNow</option>
              <option value="Bank Transfer">{t("payout.bankTransfer")}</option>
            </select>
          </div>
          {f.paymentMethod === "PayNow" ? (
            <div>
              <Label htmlFor="pn">{t("payout.paynowNumber")}</Label>
              <Input id="pn" value={f.paynowNumber ?? ""} onChange={(e) => set({ paynowNumber: e.target.value })} placeholder={t("payout.paynowPlaceholder")} />
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="bank">{t("payout.bankName")}</Label>
                <Input id="bank" value={f.bankName ?? ""} onChange={(e) => set({ bankName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="acc">{t("payout.bankAccount")}</Label>
                <Input id="acc" value={f.bankAccountNumber ?? ""} onChange={(e) => set({ bankAccountNumber: e.target.value })} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-[16px] text-ink">{t("agreement.title")}</h2>
        <div className="max-h-44 overflow-y-auto rounded-lg border border-line bg-paper-100 p-4 text-[12px] leading-relaxed text-muted">
          <p>{t("agreement.para1")}</p>
          <p className="mt-2">{t("agreement.para2")}</p>
        </div>
        <label className="mt-4 flex items-start gap-2.5 text-[13px] text-body">
          <input type="checkbox" className="mt-0.5" checked={f.agreementAccepted} onChange={(e) => set({ agreementAccepted: e.target.checked })} />
          <span>{t("agreement.checkbox")}</span>
        </label>

        <div className="mt-4">
          <Label>{t("agreement.signatureLabel")}</Label>
          <SignaturePad onChange={(dataUrl) => set({ signature: dataUrl ?? undefined })} />
          <p className="mt-1 text-[12px] text-muted-2">{t("agreement.signatureHint")}</p>
        </div>
      </div>

      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <Button onClick={submit} disabled={pending || !f.nric || !f.agreementAccepted || !f.signature} className="w-full sm:w-auto">
        {pending ? t("submitPending") : t("submit")}
      </Button>
    </div>
  );
}
