"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import type { Alert } from "./app-shell";

export function NotificationsBell({ alerts }: { alerts: Alert[] }) {
  const tNav = useTranslations("nav");
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = alerts.filter((a) => a.count > 0);
  const total = active.reduce((n, a) => n + a.count, 0);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-label={t("notifications")}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-2 text-ink hover:bg-paper-200"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-action px-1 text-[10px] font-semibold text-white">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-line bg-white p-1.5 shadow-lg">
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
            {t("notifications")}
          </div>
          {active.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-muted">{t("allCaughtUp")}</p>
          ) : (
            active.map((a) => (
              <Link
                key={a.labelKey}
                href={a.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-[13px] text-ink hover:bg-paper-100"
              >
                <span>{tNav(a.labelKey)}</span>
                <span className="rounded-full bg-action px-1.5 py-0.5 text-[11px] font-semibold text-white">{a.count}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
