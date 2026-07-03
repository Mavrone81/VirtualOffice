"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { changePassword } from "@/server/account/actions";

export function ChangePasswordForm() {
  const t = useTranslations("account");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  function submit() {
    setError(undefined);
    setDone(false);
    if (next !== confirm) { setError(t("changePassword.errors.mismatch")); return; }
    start(async () => {
      const r = await changePassword(cur, next);
      if (r.ok) { setDone(true); setCur(""); setNext(""); setConfirm(""); }
      else setError(r.error ?? t("changePassword.errors.failed"));
    });
  }

  return (
    <Card className="max-w-md p-5">
      <div className="space-y-4">
        <div>
          <Label htmlFor="cur">{t("changePassword.currentPassword")}</Label>
          <Input id="cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="new">{t("changePassword.newPassword")}</Label>
          <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <p className="mt-1 text-[12px] text-muted-2">{t("changePassword.newPasswordHint")}</p>
        </div>
        <div>
          <Label htmlFor="cf">{t("changePassword.confirmPassword")}</Label>
          <Input id="cf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{error}</p>}
        {done && <p className="rounded-lg bg-success-50 px-3 py-2 text-[13px] text-success">{t("changePassword.successMessage")}</p>}
        <Button onClick={submit} disabled={pending || !cur || !next || !confirm}>
          {pending ? t("changePassword.updatingButton") : t("changePassword.updateButton")}
        </Button>
      </div>
    </Card>
  );
}
