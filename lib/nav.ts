import {
  LayoutDashboard, UserPlus, Users, BadgeCheck, Receipt, Tags, Calculator,
  FileText, Banknote, Megaphone, FolderOpen, Handshake, FileSignature,
  IdCard, FolderLock, type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href?: string; // omitted => not yet built (rendered disabled)
  icon: LucideIcon;
  badgeKey?: string; // dynamic count key resolved by the shell
};
export type NavGroup = { title: string; items: NavItem[] };

export const adminNav: NavGroup[] = [
  {
    title: "Operations",
    items: [
      { label: "Overview", href: "/admin/dashboard", icon: LayoutDashboard },
      { label: "Recruitment", icon: UserPlus, badgeKey: "recruit" },
      { label: "Associates", icon: Users },
      { label: "Sales · Verify", icon: BadgeCheck, badgeKey: "verify" },
      { label: "Transactions", icon: Receipt },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Products & Com", icon: Tags },
      { label: "Commission", icon: Calculator },
      { label: "Invoices", icon: FileText },
      { label: "Payouts", icon: Banknote },
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

export const portalNav: NavGroup[] = [
  {
    title: "My Office",
    items: [
      { label: "Dashboard", href: "/portal/dashboard", icon: LayoutDashboard },
      { label: "My Sales", icon: Receipt },
      { label: "My Commissions", icon: Calculator },
      { label: "My Payouts", icon: Banknote },
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
