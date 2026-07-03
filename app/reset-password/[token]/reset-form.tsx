"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/server/account/actions";

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("reset");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");

  function submit() {
    setError(undefined);
    if (pw !== confirm) { setError(t("mismatch")); return; }
    start(async () => {
      const r = await resetPassword(token, pw);
      if (r.ok) setDone(true);
      else setError(r.error ?? t("mismatch"));
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-line bg-white p-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-success-50 text-xl text-success">✓</div>
        <h1 className="font-display text-[20px] text-ink">{t("successTitle")}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t("successBody")}</p>
        <Button asChild className="mt-4"><Link href="/login">{t("signIn")}</Link></Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-[26px] text-ink">{t("resetTitle")}</h1>
      </div>
      <div className="space-y-4">
        <div>
          <Label htmlFor="pw">{t("newPassword")}</Label>
          <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <p className="mt-1 text-[12px] text-muted-2">{t("newPasswordHint")}</p>
        </div>
        <div>
          <Label htmlFor="cf">{t("confirmPassword")}</Label>
          <Input id="cf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
        <Button className="w-full" onClick={submit} disabled={pending || !pw || !confirm}>{pending ? t("updating") : t("updateButton")}</Button>
      </div>
    </div>
  );
}
