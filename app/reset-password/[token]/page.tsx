import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Reset password · Enshrine Virtual Office" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("auth");
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink font-display text-lg text-white">E</div>
            <div className="leading-tight">
              <div className="font-display text-[16px] text-ink">{t("brand")}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-2">{t("brandSub")}</div>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
        <ResetForm token={token} />
      </div>
    </main>
  );
}
