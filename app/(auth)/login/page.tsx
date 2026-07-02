import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "./login-form";
import { LanguageSwitcher } from "@/components/shell/language-switcher";

export const metadata: Metadata = { title: "Sign in · Enshrine Virtual Office" };

export default async function LoginPage() {
  const t = await getTranslations("auth");
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 font-display text-lg">E</div>
          <div className="leading-tight">
            <div className="font-display text-[17px]">{t("brand")}</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">{t("brandSub")}</div>
          </div>
        </div>
        <div className="max-w-sm">
          <h2 className="font-display text-3xl leading-snug">
            {t("heroTitle")} <em className="text-gold-300">{t("heroEmphasis")}</em>.
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-white/55">
            {t("heroBody")}
          </p>
        </div>
        <p className="text-[11px] text-white/35">
          {t("companies")}
        </p>
      </div>

      {/* Sign-in panel */}
      <div className="flex items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-[28px] text-ink">{t("signInTitle")}</h1>
              <p className="mt-1 text-[14px] text-muted">{t("signInSubtitle")}</p>
            </div>
            <LanguageSwitcher />
          </div>
          <LoginForm />
          <p className="mt-8 text-center text-[12px] text-muted-2">
            {t("trouble")}
          </p>
        </div>
      </div>
    </main>
  );
}
