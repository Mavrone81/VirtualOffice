"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { requestPasswordReset } from "@/server/account/actions";

export function ForgotForm() {
  const t = useTranslations("reset");
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");

  function submit() {
    start(async () => {
      await requestPasswordReset(email);
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-line bg-white p-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-success-50 text-xl text-success">✓</div>
        <h1 className="font-display text-[20px] text-ink">{t("sentTitle")}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t("sentBody")}</p>
        <Link href="/login" className="mt-4 inline-block text-[13px] text-action hover:underline">{t("backToLogin")}</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-[26px] text-ink">{t("forgotTitle")}</h1>
        <p className="mt-1 text-[14px] text-muted">{t("forgotSubtitle")}</p>
      </div>
      <div className="space-y-4">
        <div>
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@enshrine.sg" />
        </div>
        <Button className="w-full" onClick={submit} disabled={pending || !email}>{pending ? t("sending") : t("sendLink")}</Button>
        <Link href="/login" className="block text-center text-[12px] text-muted-2 hover:text-ink">{t("backToLogin")}</Link>
      </div>
    </div>
  );
}
