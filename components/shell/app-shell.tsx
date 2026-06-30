"use client";

import { useState } from "react";
import { Sidebar, type ShellUser } from "./sidebar";
import { Topbar } from "./topbar";
import type { ShellArea } from "@/lib/nav";

export function AppShell({
  area,
  user,
  badges,
  period = "FY26 · June",
  children,
}: {
  area: ShellArea;
  user: ShellUser;
  badges?: Record<string, number>;
  period?: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen bg-paper">
      <Sidebar area={area} user={user} badges={badges} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="lg:pl-[240px]">
        <Topbar user={user} period={period} onMenu={() => setMobileOpen(true)} />
        <main className="px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
