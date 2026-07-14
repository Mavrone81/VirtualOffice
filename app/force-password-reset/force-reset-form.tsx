"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword } from "@/server/account/actions";
import { doSignOut } from "@/lib/auth-actions";

export function ForceResetForm() {
  const t = useTranslations("forceReset");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  function submit() {
    setError(undefined);
    if (next !== confirm) {
      setError(t("mismatch"));
      return;
    }
    start(async () => {
      const r = await changePassword(cur, next);
      if (r.ok) {
        // Password + DB flag are updated; sign out so the next login mints a
        // fresh token without mustResetPassword. doSignOut redirects to /login.
        await doSignOut();
      } else {
        setError(r.error ?? t("failed"));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="cur">{t("currentPassword")}</Label>
        <Input id="cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="new">{t("newPassword")}</Label>
        <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <p className="mt-1 text-[12px] text-muted-2">{t("hint")}</p>
      </div>
      <div>
        <Label htmlFor="cf">{t("confirmPassword")}</Label>
        <Input id="cf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
      <Button className="w-full" onClick={submit} disabled={pending || !cur || !next || !confirm}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </div>
  );
}
