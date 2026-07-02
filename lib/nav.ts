import {
  LayoutDashboard, UserPlus, Users, BadgeCheck, Receipt, Tags, Calculator,
  FileText, Banknote, Megaphone, FolderOpen, Handshake, FileSignature,
  IdCard, FolderLock, Network, type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@prisma/client";

export type NavItem = {
  label: string;
  href?: string; // omitted => not yet built (rendered disabled)
  icon: LucideIcon;
  badgeKey?: string; // dynamic count key resolved by the shell
  roles?: AppRole[]; // when set, item shows only for these roles
};
export type NavGroup = { title: string; items: NavItem[] };

export const adminNav: NavGroup[] = [
  {
    title: "Operations",
    items: [
      { label: "Overview", href: "/admin/dashboard", icon: LayoutDashboard },
      { label: "Recruitment", href: "/admin/recruitment", icon: UserPlus, badgeKey: "recruit" },
      { label: "Associates", href: "/admin/associates", icon: Users },
      { label: "Sales · Verify", href: "/admin/sales/verify", icon: BadgeCheck, badgeKey: "verify" },
      { label: "Transactions", href: "/admin/sales/transactions", icon: Receipt },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Products & Com", href: "/admin/products", icon: Tags },
      { label: "Commission", href: "/admin/commission", icon: Calculator },
      { label: "Invoices", href: "/admin/invoices", icon: FileText },
      { label: "Payouts", href: "/admin/payouts", icon: Banknote },
    ],
  },
  {
    title: "Workspace",
    items: [
      { label: "Notices", icon: Megaphone },
      { label: "Documents", icon: FolderOpen },
      { label: "Vendor Approvals", icon: Handshake, badgeKey: "vendor" },
    ],
  },
];

const MANAGER_ROLES: AppRole[] = ["SalesManager", "SalesDirector"];

export const portalNav: NavGroup[] = [
  {
    title: "My Office",
    items: [
      { label: "Dashboard", href: "/portal/dashboard", icon: LayoutDashboard },
      { label: "My Sales", href: "/portal/sales", icon: Receipt },
      { label: "My Commissions", href: "/portal/commissions", icon: Calculator },
      { label: "My Payouts", href: "/portal/payouts", icon: Banknote },
    ],
  },
  {
    title: "My Team",
    items: [
      { label: "Team Overview", href: "/portal/team", icon: Network, roles: MANAGER_ROLES },
      { label: "Team Sales", href: "/portal/team/sales", icon: Receipt, roles: MANAGER_ROLES },
      { label: "Team Commissions", href: "/portal/team/commissions", icon: Calculator, roles: MANAGER_ROLES },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Notices", icon: Megaphone },
      { label: "Documents", icon: FolderOpen },
      { label: "Vendor Registry", icon: Handshake },
      { label: "Sales Agreements", icon: FileSignature },
    ],
  },
  {
    title: "My Records",
    items: [
      { label: "Name Card", icon: IdCard },
      { label: "My P-File", icon: FolderLock },
    ],
  },
];

export const navByArea = { admin: adminNav, portal: portalNav } as const;
export type ShellArea = keyof typeof navByArea;
