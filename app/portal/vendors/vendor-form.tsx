"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { submitVendor, type VendorInput } from "@/server/vendors/actions";
import { useTranslations } from "next-intl";

export function VendorForm() {
  const router = useRouter();
  const t = useTranslations("portal");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [f, setF] = useState<VendorInput>({ vendorName: "" });
  const set = (patch: Partial<VendorInput>) => setF((p) => ({ ...p, ...patch }));

  function submit() {
    setError(undefined);
    start(async () => {
      const r = await submitVendor(f);
      if (r.ok) { setF({ vendorName: "" }); setDone(true); router.refresh(); setTimeout(() => setDone(false), 2500); }
      else setError(r.error ?? t("vendors.couldNotSubmit"));
    });
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-display text-[17px] text-ink">{t("vendors.referVendor")}</h2>
      <div className="space-y-4">
        <div>
          <Label htmlFor="vn">{t("vendors.vendorName")}</Label>
          <Input id="vn" value={f.vendorName} onChange={(e) => set({ vendorName: e.target.value })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="vt">{t("vendors.vendorType")}</Label>
            <Input id="vt" value={f.vendorType ?? ""} onChange={(e) => set({ vendorType: e.target.value })} placeholder={t("vendors.vendorTypePlace")} />
          </div>
          <div>
            <Label htmlFor="vc">{t("vendors.contact")}</Label>
            <Input id="vc" value={f.contact ?? ""} onChange={(e) => set({ contact: e.target.value })} placeholder={t("vendors.contactPlace")} />
          </div>
        </div>
        <div>
          <Label htmlFor="vr">{t("vendors.notes")}</Label>
          <textarea id="vr" value={f.remarks ?? ""} onChange={(e) => set({ remarks: e.target.value })} rows={3}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-action focus:outline-none" />
        </div>
        <div>
          <Label htmlFor="vag">{t("vendors.agreementLabel")}</Label>
          <input id="vag" type="file" onChange={(e) => set({ agreement: e.target.files?.[0] ?? null })}
            className="block w-full text-[13px] text-body file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-[13px] file:text-white hover:file:bg-ink-700" />
          <p className="mt-1 text-[12px] text-muted-2">{t("vendors.agreementHint")}</p>
        </div>
        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
        {done && <p className="rounded-lg bg-success-50 px-3 py-2 text-[13px] text-success">{t("vendors.submittedOk")}</p>}
        <Button onClick={submit} disabled={pending || !f.vendorName}>{pending ? t("vendors.submitting") : t("vendors.submitReferral")}</Button>
      </div>
    </Card>
  );
}
