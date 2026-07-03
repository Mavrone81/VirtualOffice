"use client";

import { useState } from "react";
import { Sidebar, type ShellUser } from "./sidebar";
import { Topbar } from "./topbar";
import type { ShellArea } from "@/lib/nav";

// One "needs attention" item surfaced in the notifications menu.
export type Alert = { labelKey: string; count: number; href: string };

export function AppShell({
  area,
  user,
  badges,
  alerts = [],
  period,
  children,
}: {
  area: ShellArea;
  user: ShellUser;
  badges?: Record<string, number>;
  alerts?: Alert[];
  period?: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-paper">
      <Sidebar area={area} user={user} badges={badges} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="lg:pl-[240px]">
        <Topbar area={area} user={user} alerts={alerts} period={period} onMenu={() => setMobileOpen(true)} />
        <main className="px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
