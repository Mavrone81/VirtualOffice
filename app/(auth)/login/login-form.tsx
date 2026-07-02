"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authenticate } from "./actions";

export function LoginForm() {
  const t = useTranslations("auth");
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@enshrine.sg" required />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <Label htmlFor="password" className="mb-0">{t("password")}</Label>
          <span className="text-[12px] text-muted">{t("forgot")}</span>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" required />
      </div>

      {errorMessage && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-[13px] text-danger">{t("invalidCredentials")}</p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? t("signingIn") : t("signInButton")}
      </Button>
    </form>
  );
}
