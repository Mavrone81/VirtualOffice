import {
  LayoutDashboard, UserPlus, Users, BadgeCheck, Receipt, Tags, Calculator,
  FileText, Banknote, Megaphone, FolderOpen, Handshake, FileSignature,
  IdCard, FolderLock, Network, ScrollText, type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@prisma/client";

export type NavItem = {
  labelKey: string; // key into the `nav` message namespace
  href?: string; // omitted => not yet built (rendered disabled)
  icon: LucideIcon;
  badgeKey?: string; // dynamic count key resolved by the shell
  roles?: AppRole[]; // when set, item shows only for these roles
};
export type NavGroup = { titleKey: string; items: NavItem[] };

export const adminNav: NavGroup[] = [
  {
    titleKey: "groupOperations",
    items: [
      { labelKey: "overview", href: "/admin/dashboard", icon: LayoutDashboard },
      { labelKey: "recruitment", href: "/admin/recruitment", icon: UserPlus, badgeKey: "recruit" },
      { labelKey: "associates", href: "/admin/associates", icon: Users },
      { labelKey: "teams", href: "/admin/teams", icon: Users, roles: ["Admin"] },
      { labelKey: "salesVerify", href: "/admin/sales/verify", icon: BadgeCheck, badgeKey: "verify" },
      { labelKey: "transactions", href: "/admin/sales/transactions", icon: Receipt },
    ],
  },
  {
    titleKey: "groupFinance",
    items: [
      { labelKey: "products", href: "/admin/products", icon: Tags, roles: ["Admin"] },
      { labelKey: "commission", href: "/admin/commission", icon: Calculator },
      { labelKey: "invoices", href: "/admin/invoices", icon: FileText },
      { labelKey: "payouts", href: "/admin/payouts", icon: Banknote },
    ],
  },
  {
    titleKey: "groupWorkspace",
    items: [
      { labelKey: "notices", href: "/admin/notices", icon: Megaphone },
      { labelKey: "documents", href: "/admin/documents", icon: FolderOpen },
      { labelKey: "vendors", href: "/admin/vendors", icon: Handshake },
      { labelKey: "nameCard", href: "/admin/name-card", icon: IdCard },
      { labelKey: "auditLog", href: "/admin/audit", icon: ScrollText },
    ],
  },
];

const MANAGER_ROLES: AppRole[] = ["SalesManager", "SalesDirector"];

export const portalNav: NavGroup[] = [
  {
    titleKey: "groupMyOffice",
    items: [
      { labelKey: "dashboard", href: "/portal/dashboard", icon: LayoutDashboard },
      { labelKey: "mySales", href: "/portal/sales", icon: Receipt },
      { labelKey: "myCommissions", href: "/portal/commissions", icon: Calculator },
      { labelKey: "myPayouts", href: "/portal/payouts", icon: Banknote },
    ],
  },
  {
    titleKey: "groupMyTeam",
    items: [
      { labelKey: "teamOverview", href: "/portal/team", icon: Network, roles: MANAGER_ROLES },
      { labelKey: "teamSales", href: "/portal/team/sales", icon: Receipt, roles: MANAGER_ROLES },
      { labelKey: "teamCommissions", href: "/portal/team/commissions", icon: Calculator, roles: MANAGER_ROLES },
    ],
  },
  {
    titleKey: "groupResources",
    items: [
      { labelKey: "notices", href: "/portal/notices", icon: Megaphone, badgeKey: "notices" },
      { labelKey: "documents", href: "/portal/documents", icon: FolderOpen },
      { labelKey: "vendorRegistry", href: "/portal/vendors", icon: Handshake },
      { labelKey: "salesAgreements", href: "/portal/sales-agreements", icon: FileSignature },
    ],
  },
  {
    titleKey: "groupMyRecords",
    items: [
      { labelKey: "nameCard", href: "/portal/name-card", icon: IdCard },
      { labelKey: "myPFile", href: "/portal/pfile", icon: FolderLock },
    ],
  },
];

export const navByArea = { admin: adminNav, portal: portalNav } as const;
export type ShellArea = keyof typeof navByArea;
