"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut, KeyRound, ChevronDown } from "lucide-react";
import type { AppRole } from "@prisma/client";
import { navByArea, type NavItem, type ShellArea } from "@/lib/nav";
import { doSignOut } from "@/lib/auth-actions";

export type ShellUser = { name: string; roleLabel: string; initials: string; subtitle?: string; role?: AppRole };

/** Path-only comparison — child hrefs may carry #anchors (dashboard metrics). */
function hrefPath(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
}

function isActive(pathname: string, href?: string): boolean {
  if (!href) return false;
  const path = hrefPath(href);
  return pathname === path || pathname.startsWith(path + "/");
}

/** A parent with children is active when itself or any child matches. */
function isBranchActive(pathname: string, item: NavItem): boolean {
  if (isActive(pathname, item.href)) return true;
  return (item.children ?? []).some((c) => isActive(pathname, c.href));
}

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
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  // Manually-toggled branches (labelKey -> open); branches with an active child
  // are always open.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const visible = (i: NavItem) => !i.roles || (user.role != null && i.roles.includes(user.role));
  const groups = navByArea[area]
    .map((g) => ({
      ...g,
      items: g.items
        .filter(visible)
        .map((i) => (i.children ? { ...i, children: i.children.filter(visible) } : i))
        .filter((i) => !i.children || i.children.length > 0),
    }))
    .filter((g) => g.items.length > 0);

  const renderLeaf = (item: NavItem, nested = false) => {
    const active = isActive(pathname, item.href);
    const badge = item.badgeKey ? badges[item.badgeKey] : undefined;
    const Icon = item.icon;
    const inner = (
      <>
        <Icon className="h-[18px] w-[18px] shrink-0 opacity-80" strokeWidth={1.75} />
        <span className="flex-1">{t(item.labelKey)}</span>
        {badge ? (
          <span className="rounded-full bg-action px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {badge}
          </span>
        ) : !item.href ? (
          <span className="text-[9px] uppercase tracking-wide text-white/25">{t("soon")}</span>
        ) : null}
      </>
    );
    const cls = `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
      active ? "bg-white/10 font-medium text-white" : "text-white/60 hover:bg-white/5 hover:text-white/90"
    } ${!item.href ? "cursor-default text-white/35 hover:bg-transparent hover:text-white/35" : ""} ${
      nested ? "text-[12.5px]" : ""
    }`;
    return (
      <li key={item.labelKey}>
        {item.href ? (
          <Link href={item.href} className={cls} onClick={onClose}>
            {inner}
          </Link>
        ) : (
          <div className={cls}>{inner}</div>
        )}
      </li>
    );
  };

  const renderBranch = (item: NavItem) => {
    const branchActive = isBranchActive(pathname, item);
    const expanded = branchActive || !!open[item.labelKey];
    const Icon = item.icon;
    const toggle = () => setOpen((o) => ({ ...o, [item.labelKey]: !expanded }));
    const headCls = `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
      branchActive ? "font-medium text-white" : "text-white/60 hover:bg-white/5 hover:text-white/90"
    }`;
    return (
      <li key={item.labelKey}>
        {item.href ? (
          <div className={`flex items-center ${branchActive ? "" : ""}`}>
            <Link href={item.href} className={`${headCls} flex-1`} onClick={onClose}>
              <Icon className="h-[18px] w-[18px] shrink-0 opacity-80" strokeWidth={1.75} />
              <span className="flex-1">{t(item.labelKey)}</span>
            </Link>
            <button
              type="button"
              aria-label={t(item.labelKey)}
              aria-expanded={expanded}
              onClick={toggle}
              className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <button type="button" aria-expanded={expanded} onClick={toggle} className={headCls}>
            <Icon className="h-[18px] w-[18px] shrink-0 opacity-80" strokeWidth={1.75} />
            <span className="flex-1">{t(item.labelKey)}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 opacity-60 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={1.75} />
          </button>
        )}
        {expanded && (
          <ul className="mt-0.5 space-y-0.5 border-l border-white/10 pl-4 ml-[19px]">
            {item.children!.map((c) => renderLeaf(c, true))}
          </ul>
        )}
      </li>
    );
  };

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
            <div key={group.titleKey} className="mb-5">
              <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-white/30">
                {t(group.titleKey)}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => (item.children ? renderBranch(item) : renderLeaf(item)))}
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
            <Link href={`/${area}/account`} aria-label={tc("account")} onClick={onClose}
              className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
              <KeyRound className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <form action={doSignOut}>
              <button type="submit" aria-label={tc("signOut")} className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
                <LogOut className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
