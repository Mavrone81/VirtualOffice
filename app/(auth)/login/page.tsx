import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "./login-form";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { NameCardFan } from "@/components/auth/name-card-fan";

export const metadata: Metadata = { title: "Sign in · Enshrine Virtual Office" };

export default async function LoginPage() {
  const t = await getTranslations("auth");
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        {/* Warm glow behind the cards, and a faint grid, so the panel isn't flat navy. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60% 45% at 50% 42%, rgba(216,178,90,0.16) 0%, rgba(216,178,90,0) 70%), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "100% 100%, 38px 38px, 38px 38px",
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 font-display text-lg">E</div>
          <div className="leading-tight">
            <div className="font-display text-[17px]">{t("brand")}</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">{t("brandSub")}</div>
          </div>
        </div>

        <div className="relative my-10 flex justify-center">
          <NameCardFan caption={t("cardsCaption")} />
        </div>

        <div className="relative max-w-sm">
          <h2 className="font-display text-3xl leading-snug">
            {t("heroTitle")} <em className="text-gold-300">{t("heroEmphasis")}</em>.
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-white/55">
            {t("heroBody")}
          </p>
          <p className="mt-8 border-t border-white/10 pt-5 text-[11px] leading-relaxed text-white/35">
            {t("companies")}
          </p>
        </div>
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
