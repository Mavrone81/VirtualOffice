"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/app/onboard/[token]/signature-pad";
import { approveReferral, rejectReferral } from "@/server/vendors/actions";

/**
 * Approve / reject controls for a Pending referral partnership (Sep 2026).
 * Approving countersigns the agreement for the Company — signer name +
 * designation, with an optional drawn signature embedded into the final PDF.
 */
export function ReferralApprovalActions({ id }: { id: string }) {
  const t = useTranslations("referrals");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [error, setError] = useState<string>();
  const [signName, setSignName] = useState("");
  const [signDesignation, setSignDesignation] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function doApprove() {
    setError(undefined);
    start(async () => {
      const r = await approveReferral(id, {
        companySignName: signName,
        companySignDesignation: signDesignation || undefined,
        signatureDataUrl: signature ?? undefined,
      });
      if (r.ok) { setMode("idle"); router.refresh(); }
      else setError(r.error);
    });
  }

  function doReject() {
    setError(undefined);
    start(async () => {
      const r = await rejectReferral(id, reason);
      if (r.ok) { setMode("idle"); router.refresh(); }
      else setError(r.error);
    });
  }

  if (mode === "idle") {
    return (
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={() => setMode("approve")}>{t("admin.approve")}</Button>
        <Button size="sm" variant="secondary" onClick={() => setMode("reject")}>{t("admin.reject")}</Button>
      </div>
    );
  }

  if (mode === "approve") {
    return (
      <div className="w-72 space-y-2 text-left">
        <div>
          <Label htmlFor={`an-${id}`}>{t("admin.signName")}</Label>
          <Input id={`an-${id}`} value={signName} onChange={(e) => setSignName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`ad-${id}`}>{t("admin.signDesignation")}</Label>
          <Input id={`ad-${id}`} value={signDesignation} onChange={(e) => setSignDesignation(e.target.value)} />
        </div>
        <div>
          <Label>{t("admin.signatureOptional")}</Label>
          <SignaturePad onChange={setSignature} />
        </div>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" disabled={pending || !signName.trim()} onClick={doApprove}>
            {pending ? "…" : t("admin.confirmApprove")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("idle")}>{t("admin.cancel")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 space-y-2 text-left">
      <div>
        <Label htmlFor={`rr-${id}`}>{t("admin.rejectReason")}</Label>
        <textarea id={`rr-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-action focus:outline-none" />
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={doReject}>{pending ? "…" : t("admin.confirmReject")}</Button>
        <Button size="sm" variant="secondary" onClick={() => setMode("idle")}>{t("admin.cancel")}</Button>
      </div>
    </div>
  );
}
