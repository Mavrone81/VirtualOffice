"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { setLocale } from "@/server/i18n/actions";
import { locales, localeShort, type Locale } from "@/i18n/config";

// Compact EN / 中 toggle. Switching writes the cookie and refreshes so the whole
// app (server + client components) re-renders in the new locale.
export function LanguageSwitcher({ tone = "light" }: { tone?: "light" | "dark" }) {
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();

  function change(l: Locale) {
    if (l === active || pending) return;
    start(async () => {
      await setLocale(l);
      router.refresh();
    });
  }

  const base = tone === "dark" ? "border-white/15 bg-white/5" : "border-line bg-white";
  const idle = tone === "dark" ? "text-white/50 hover:text-white" : "text-muted hover:text-ink";
  const activeCls = tone === "dark" ? "bg-white/15 text-white" : "bg-ink text-white";

  return (
    <div className={`inline-flex items-center rounded-lg border p-0.5 text-[12px] ${base} ${pending ? "opacity-60" : ""}`} role="group" aria-label="Language">
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => change(l)}
          aria-pressed={l === active}
          className={`rounded-md px-2 py-1 font-medium transition-colors ${l === active ? activeCls : idle}`}
        >
          {localeShort[l]}
        </button>
      ))}
    </div>
  );
}
