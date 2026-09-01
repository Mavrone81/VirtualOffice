"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { SignaturePad } from "@/app/onboard/[token]/signature-pad";
import { submitReferralPartnership, type ReferralSubmissionInput } from "@/server/vendors/actions";
import { useTranslations } from "next-intl";

type F = Omit<ReferralSubmissionInput, "signatureDataUrl">;

/**
 * Referral partnership submission (consolidated menu, Sep 2026): the associate
 * fills the Referral & Marketing Partnership Agreement e-form, hands the
 * device to the vendor to sign, and submits — landing Pending for admin
 * approval on the everyone-visible Partner List.
 */
export function ReferralForm() {
  const router = useRouter();
  const t = useTranslations("referrals");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [signature, setSignature] = useState<string | null>(null);
  const [f, setF] = useState<F>({ vendorName: "", vendorSignerName: "" });
  const set = (patch: Partial<F>) => setF((p) => ({ ...p, ...patch }));

  const canSubmit = !!f.vendorName.trim() && !!f.vendorSignerName.trim() && !!signature && !pending;

  function submit() {
    if (!signature) return;
    setError(undefined);
    start(async () => {
      const r = await submitReferralPartnership({ ...f, signatureDataUrl: signature });
      if (r.ok) router.push("/portal/referrals");
      else setError(r.error ?? t("form.couldNotSubmit"));
    });
  }

  return (
    <Card className="p-5">
      <div className="space-y-4">
        <div>
          <Label htmlFor="rn">{t("form.vendorName")}</Label>
          <Input id="rn" value={f.vendorName} onChange={(e) => set({ vendorName: e.target.value })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="rt">{t("form.vendorType")}</Label>
            <Input id="rt" value={f.vendorType ?? ""} onChange={(e) => set({ vendorType: e.target.value })} placeholder={t("form.vendorTypePlace")} />
          </div>
          <div>
            <Label htmlFor="rc">{t("form.contact")}</Label>
            <Input id="rc" value={f.contact ?? ""} onChange={(e) => set({ contact: e.target.value })} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ru">{t("form.vendorUen")}</Label>
            <Input id="ru" value={f.vendorUen ?? ""} onChange={(e) => set({ vendorUen: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="ra">{t("form.vendorAddress")}</Label>
            <Input id="ra" value={f.vendorAddress ?? ""} onChange={(e) => set({ vendorAddress: e.target.value })} />
          </div>
        </div>
        <div>
          <Label htmlFor="rr">{t("form.notes")}</Label>
          <textarea id="rr" value={f.remarks ?? ""} onChange={(e) => set({ remarks: e.target.value })} rows={3}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-action focus:outline-none" />
        </div>

        <div className="border-t border-line pt-4">
          <h3 className="mb-1 font-display text-[15px] text-ink">{t("form.signerHeading")}</h3>
          <p className="mb-3 text-[12.5px] text-muted">{t("form.signerHint")}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="sn">{t("form.signerName")}</Label>
              <Input id="sn" value={f.vendorSignerName} onChange={(e) => set({ vendorSignerName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="si">{t("form.signerNric")}</Label>
              <Input id="si" value={f.vendorSignerNric ?? ""} onChange={(e) => set({ vendorSignerNric: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sd">{t("form.signerDesignation")}</Label>
              <Input id="sd" value={f.vendorSignerDesignation ?? ""} onChange={(e) => set({ vendorSignerDesignation: e.target.value })} />
            </div>
          </div>
          <div className="mt-3">
            <Label>{t("form.signatureLabel")}</Label>
            <SignaturePad onChange={setSignature} />
          </div>
        </div>

        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button onClick={submit} disabled={!canSubmit}>
          {pending ? t("form.submitting") : t("form.submit")}
        </Button>
      </div>
    </Card>
  );
}
