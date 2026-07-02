import {
  LayoutDashboard, UserPlus, Users, BadgeCheck, Receipt, Tags, Calculator,
  FileText, Banknote, Megaphone, FolderOpen, Handshake, FileSignature,
  IdCard, FolderLock, Network, ScrollText, type LucideIcon,
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
      { label: "Notices", href: "/admin/notices", icon: Megaphone },
      { label: "Documents", href: "/admin/documents", icon: FolderOpen },
      { label: "Vendors", href: "/admin/vendors", icon: Handshake },
      { label: "Name Card", href: "/admin/name-card", icon: IdCard },
      { label: "Audit Log", href: "/admin/audit", icon: ScrollText },
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
      { label: "Notices", href: "/portal/notices", icon: Megaphone, badgeKey: "notices" },
      { label: "Documents", href: "/portal/documents", icon: FolderOpen },
      { label: "Vendor Registry", href: "/portal/vendors", icon: Handshake },
      { label: "Sales Agreements", href: "/portal/sales-agreements", icon: FileSignature },
    ],
  },
  {
    title: "My Records",
    items: [
      { label: "Name Card", href: "/portal/name-card", icon: IdCard },
      { label: "My P-File", href: "/portal/pfile", icon: FolderLock },
    ],
  },
];

export const navByArea = { admin: adminNav, portal: portalNav } as const;
export type ShellArea = keyof typeof navByArea;
