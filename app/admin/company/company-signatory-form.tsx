"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { updateCompanySignatory } from "@/server/company/actions";
import { SignaturePad } from "@/app/onboard/[token]/signature-pad";
import { signatureDataUrlToFile } from "@/lib/signature-file";

type SignatoryData = { signatoryName: string | null; signatureFileKey: string | null; updatedAt: Date | null };

// CR-0001: the signature preview goes through the SAME gated /api/files
// route every other document in this app uses (app/admin/associates/[id]/page.tsx
// is the pattern) — never a second route, since the owner ruled this image
// Admin-only specifically because it is a forgery vector.
export function CompanySignatoryForm({ initial }: { initial: SignatoryData }) {
  const t = useTranslations("company");
  const tc = useTranslations("common");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [name, setName] = useState(initial.signatoryName ?? "");
  const [signatureFileKey, setSignatureFileKey] = useState(initial.signatureFileKey);
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  // Preview a newly-picked file immediately, without waiting on the save
  // round-trip — cleared once the save completes (the real preview then
  // comes from the saved signatureFileKey, through the gated route).
  const [localPreview, setLocalPreview] = useState<string>();
  // A drawn signature is converted to a PNG File and saved through the same
  // updateCompanySignatory upload path as a picked file — one storage route,
  // one set of size/type checks. Drawn and picked are mutually exclusive.
  const [drawing, setDrawing] = useState(false);
  const [drawnFile, setDrawnFile] = useState<File | null>(null);

  function setPreview(next?: string) {
    setLocalPreview((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return next;
    });
  }

  function pickFile() {
    inputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDrawing(false);
    setDrawnFile(null);
    setPreview(URL.createObjectURL(file));
  }

  function startDrawing() {
    setError(undefined);
    if (inputRef.current) inputRef.current.value = "";
    setPreview(undefined);
    setDrawing(true);
  }

  function cancelDrawing() {
    setDrawing(false);
    setDrawnFile(null);
    setPreview(undefined);
  }

  function onDrawn(dataUrl: string | null) {
    const file = dataUrl ? signatureDataUrlToFile(dataUrl) : null;
    setDrawnFile(file);
    setPreview(file && dataUrl ? dataUrl : undefined);
  }

  function removeSignature() {
    setError(undefined);
    start(async () => {
      const r = await updateCompanySignatory({ signatureFile: null });
      if (r.ok) {
        setSignatureFileKey(null);
        setPreview(undefined);
        setDrawing(false);
        setDrawnFile(null);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else {
        setError(r.error ?? t("couldNotSave"));
      }
    });
  }

  function save() {
    setError(undefined);
    start(async () => {
      const file = drawnFile ?? inputRef.current?.files?.[0];
      const r = await updateCompanySignatory({
        signatoryName: name.trim(),
        signatureFile: file,
      });
      if (r.ok) {
        setUpdatedAt(new Date());
        if (file) {
          setDrawing(false);
          setDrawnFile(null);
          // The real key isn't returned by the action (it's audited, not
          // echoed) — a router refresh re-fetches it server-side; keep the
          // local object-URL preview showing until that round-trip lands.
          router.refresh();
        }
      } else {
        setError(r.error ?? t("couldNotSave"));
      }
    });
  }

  const previewSrc = localPreview ?? (signatureFileKey ? `/api/files/${signatureFileKey}` : undefined);

  return (
    <Card className="max-w-xl p-5">
      <div className="space-y-4">
        <div>
          <Label htmlFor="signatoryName">{t("signatoryNameLabel")}</Label>
          <Input id="signatoryName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <Label>{t("signatureLabel")}</Label>
          <div className="mt-1 flex items-center gap-4">
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- same gated-route pattern as app/admin/associates/[id]/page.tsx
              <img src={previewSrc} alt={t("signatureLabel")} className="h-16 w-40 rounded-md border border-line bg-white object-contain p-1" />
            ) : (
              <span className="text-[13px] text-muted-2">{t("noSignature")}</span>
            )}
            <div className="flex flex-col gap-1">
              <input ref={inputRef} type="file" accept="image/png" className="hidden" onChange={onFileChange} />
              <Button type="button" size="sm" variant="secondary" onClick={pickFile} disabled={pending}>
                {signatureFileKey ? t("replaceSignature") : t("uploadSignature")}
              </Button>
              {!drawing && (
                <Button type="button" size="sm" variant="secondary" onClick={startDrawing} disabled={pending}>
                  {t("drawSignature")}
                </Button>
              )}
              {signatureFileKey && (
                <Button type="button" size="sm" variant="ghost" onClick={removeSignature} disabled={pending}>
                  {t("removeSignature")}
                </Button>
              )}
            </div>
          </div>
          {drawing && (
            <div className="mt-3 max-w-sm">
              <SignaturePad onChange={onDrawn} />
              <Button type="button" size="sm" variant="ghost" onClick={cancelDrawing} disabled={pending}>
                {tc("cancel")}
              </Button>
            </div>
          )}
          <p className="mt-1 text-[12px] text-muted-2">{t("pngOnlyHint")}</p>
        </div>

        {updatedAt && <p className="text-[12px] text-muted-2">{t("savedAt", { date: format(updatedAt, "dd MMM yyyy HH:mm") })}</p>}

        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}

        <Button onClick={save} disabled={pending || !name.trim()}>
          {pending ? tc("saving") : t("saveBtn")}
        </Button>
      </div>
    </Card>
  );
}
