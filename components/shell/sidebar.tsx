"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { navByArea, type ShellArea } from "@/lib/nav";
import { doSignOut } from "@/lib/auth-actions";

export type ShellUser = { name: string; roleLabel: string; initials: string; subtitle?: string };

export function Sidebar({
  area,
  user,
  badges = {},
  mobileOpen,
  onClose,
}: {
  area: ShellArea;
  user: ShellUser;
  badges?: Record<string, number>;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const groups = navByArea[area];

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[240px] flex-col bg-ink text-white transition-transform lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 font-display text-lg">E</div>
          <div className="leading-tight">
            <div className="font-display text-[16px]">Enshrine</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Virtual Office</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((group) => (
            <div key={group.title} className="mb-5">
              <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-white/30">
                {group.title}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = item.href && (pathname === item.href || pathname.startsWith(item.href + "/"));
                  const badge = item.badgeKey ? badges[item.badgeKey] : undefined;
                  const Icon = item.icon;
                  const inner = (
                    <>
                      <Icon className="h-[18px] w-[18px] shrink-0 opacity-80" strokeWidth={1.75} />
                      <span className="flex-1">{item.label}</span>
                      {badge ? (
                        <span className="rounded-full bg-action px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {badge}
                        </span>
                      ) : !item.href ? (
                        <span className="text-[9px] uppercase tracking-wide text-white/25">soon</span>
                      ) : null}
                    </>
                  );
                  const cls = `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                    active ? "bg-white/10 font-medium text-white" : "text-white/60 hover:bg-white/5 hover:text-white/90"
                  } ${!item.href ? "cursor-default text-white/35 hover:bg-transparent hover:text-white/35" : ""}`;
                  return (
                    <li key={item.label}>
                      {item.href ? (
                        <Link href={item.href} className={cls} onClick={onClose}>
                          {inner}
                        </Link>
                      ) : (
                        <div className={cls}>{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-white/10 px-3 py-3">
          <div className="flex items-center gap-2.5 px-1.5 py-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold">
              {user.initials}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-medium">{user.name}</div>
              <div className="truncate text-[11px] text-white/40">{user.roleLabel}</div>
            </div>
            <form action={doSignOut}>
              <button type="submit" aria-label="Sign out" className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
                <LogOut className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
