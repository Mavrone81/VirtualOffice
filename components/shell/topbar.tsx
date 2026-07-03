"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ShellUser } from "./sidebar";
import type { Alert } from "./app-shell";
import type { ShellArea } from "@/lib/nav";
import { LanguageSwitcher } from "./language-switcher";
import { NotificationsBell } from "./notifications-bell";

export function Topbar({
  area,
  user,
  alerts,
  period,
  onMenu,
}: {
  area: ShellArea;
  user: ShellUser;
  alerts: Alert[];
  period?: string;
  onMenu: () => void;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [q, setQ] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query) router.push(`/${area}/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-paper/85 px-4 backdrop-blur lg:px-6">
      <button onClick={onMenu} aria-label={t("openMenu")} className="rounded-md p-2 text-ink hover:bg-paper-200 lg:hidden">
        <Menu className="h-5 w-5" />
      </button>

      <form onSubmit={submit} className="relative hidden max-w-md flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-9 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-[13px] text-ink placeholder:text-muted-2 focus:border-action focus:outline-none"
        />
      </form>

      <div className="ml-auto flex items-center gap-2">
        <LanguageSwitcher />
        {period && (
          <span className="hidden rounded-full border border-line bg-white px-3 py-1 text-[12px] text-muted sm:inline">
            {period}
          </span>
        )}
        <NotificationsBell alerts={alerts} />
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-white">
          {user.initials}
        </div>
      </div>
    </header>
  );
}
