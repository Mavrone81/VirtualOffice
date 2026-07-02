"use client";

import { Menu, Search, Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ShellUser } from "./sidebar";
import { LanguageSwitcher } from "./language-switcher";

export function Topbar({ user, period, onMenu }: { user: ShellUser; period: string; onMenu: () => void }) {
  const t = useTranslations("common");
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-paper/85 px-4 backdrop-blur lg:px-6">
      <button onClick={onMenu} aria-label={t("openMenu")} className="rounded-md p-2 text-ink hover:bg-paper-200 lg:hidden">
        <Menu className="h-5 w-5" />
      </button>

      <div className="relative hidden max-w-md flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
        <input
          placeholder={t("searchPlaceholder")}
          className="h-9 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-[13px] text-ink placeholder:text-muted-2 focus:border-action focus:outline-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <LanguageSwitcher />
        <span className="hidden rounded-full border border-line bg-white px-3 py-1 text-[12px] text-muted sm:inline">
          {period}
        </span>
        <button aria-label={t("notifications")} className="relative rounded-md p-2 text-ink hover:bg-paper-200">
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-action" />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-white">
          {user.initials}
        </div>
      </div>
    </header>
  );
}
