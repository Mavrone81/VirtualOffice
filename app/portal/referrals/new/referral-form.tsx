"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { SignaturePad } from "@/app/onboard/[token]/signature-pad";
import { submitReferralPartnership, type ReferralSubmissionInput } from "@/server/vendors/actions";
import { useTranslations } from "next-intl";

type F = Omit<ReferralSubmissionInput, "signatureDataUrl" | "agreementRead">;

/**
 * Referral partnership submission (consolidated menu, Sep 2026): the associate
 * fills the Referral & Marketing Partnership Agreement e-form, hands the
 * device to the vendor to sign, and submits — landing Pending for admin
 * approval on the everyone-visible Partner List.
 *
 * A12 (Sep 2026): the vendor can't sign blindly. The signature pad stays
 * locked until the full agreement — rendered with their details — has been
 * opened (in the device's own PDF viewer, via /portal/referrals/preview) and
 * the vendor ticks that they have read it. Editing any detail afterwards
 * resets that, so what they read is what they sign.
 */
export function ReferralForm() {
  const router = useRouter();
  const t = useTranslations("referrals");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [signature, setSignature] = useState<string | null>(null);
  const [f, setF] = useState<F>({ vendorName: "", vendorSignerName: "" });
  const set = (patch: Partial<F>) => setF((p) => ({ ...p, ...patch }));

  // A12 read-before-sign state
  const [opened, setOpened] = useState(false);
  const [read, setRead] = useState(false);
  const detailsReady = !!f.vendorName.trim() && !!f.vendorSignerName.trim();
  const canSign = detailsReady && opened && read;
  const canSubmit = canSign && !!signature && !pending;

  // Any change to the details invalidates what was read.
  useEffect(() => {
    setOpened(false);
    setRead(false);
    setSignature(null);
  }, [f.vendorName, f.vendorUen, f.vendorAddress, f.vendorSignerName, f.vendorSignerNric, f.vendorSignerDesignation]);

  function submit() {
    if (!signature) return;
    setError(undefined);
    start(async () => {
      const r = await submitReferralPartnership({ ...f, signatureDataUrl: signature, agreementRead: read });
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

          {/* A12: read the full agreement before signing */}
          <div className="mt-5 rounded-xl border border-line bg-paper-100 p-4">
            <h4 className="font-display text-[15px] text-ink">{t("form.readHeading")}</h4>
            <p className="mt-1 text-[12.5px] text-muted">{t("form.readHint")}</p>
            {/* POST (not a link) so the details never sit in a URL; opens in the device's PDF viewer. */}
            <form method="post" action="/portal/referrals/preview" target="_blank" onSubmit={() => setOpened(true)} className="mt-3">
              <input type="hidden" name="vendorName" value={f.vendorName} />
              <input type="hidden" name="vendorUen" value={f.vendorUen ?? ""} />
              <input type="hidden" name="vendorAddress" value={f.vendorAddress ?? ""} />
              <input type="hidden" name="vendorSignerName" value={f.vendorSignerName} />
              <input type="hidden" name="vendorSignerNric" value={f.vendorSignerNric ?? ""} />
              <input type="hidden" name="vendorSignerDesignation" value={f.vendorSignerDesignation ?? ""} />
              <Button type="submit" variant="secondary" disabled={!detailsReady}>
                {opened ? t("form.openAgain") : t("form.showAgreement")}
              </Button>
            </form>
            {opened && (
              <label className="mt-3 flex items-start gap-2.5 text-[13.5px] text-ink">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={read} onChange={(e) => setRead(e.target.checked)} />
                <span>{t("form.readConfirm", { name: f.vendorSignerName.trim() || "—" })}</span>
              </label>
            )}
            {!detailsReady && <p className="mt-2 text-[12px] text-muted">{t("form.fillFirst")}</p>}
          </div>

          <div className="mt-4">
            <Label>{t("form.signatureLabel")}</Label>
            {canSign ? (
              <SignaturePad onChange={setSignature} />
            ) : (
              <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-line text-[13px] text-muted">
                {t("form.signLocked")}
              </div>
            )}
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
