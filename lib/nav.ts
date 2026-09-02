import {
  LayoutDashboard, UserPlus, Users, BadgeCheck, Receipt, Tags, Calculator,
  FileText, Banknote, Megaphone, FolderOpen, Handshake, FileSignature,
  IdCard, FolderLock, Network, ScrollText, ClipboardCheck, Split, FileCheck,
  TrendingUp, Wallet, HandCoins, ListChecks, GitBranch, Mail, Image, Palette,
  PartyPopper, Store, type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@prisma/client";

export type NavItem = {
  labelKey: string; // key into the `nav` message namespace
  href?: string; // omitted => not yet built (rendered disabled)
  icon: LucideIcon;
  badgeKey?: string; // dynamic count key resolved by the shell
  roles?: AppRole[]; // when set, item shows only for these roles
  children?: NavItem[]; // consolidated menu (Sep 2026): collapsible sub-items
};
export type NavGroup = { titleKey: string; items: NavItem[] };

const MANAGER_ROLES: AppRole[] = ["SalesAssistantManager", "SalesManager", "SalesDirector"];
// Mirror lib/rbac.ts (kept local so nav.ts doesn't pull prisma into the client bundle).
const RECRUITER_ROLES: AppRole[] = ["SalesAssistantManager", "SalesManager", "SalesDirector", "Admin"];
const DIRECTOR_ROLES: AppRole[] = ["SalesDirector", "Admin"];

// ---------------------------------------------------------------------------
// Consolidated menu (Sep 2026 sketch): Personal Performance / Recruitment /
// Forms & Submission / Marketing / Products & Services, plus a small Resources
// tail for the workspace pages the sketch leaves in place.
// ---------------------------------------------------------------------------

export const adminNav: NavGroup[] = [
  {
    titleKey: "groupPerformance",
    items: [
      { labelKey: "overview", href: "/admin/dashboard", icon: LayoutDashboard },
      {
        labelKey: "transactions", icon: Receipt,
        children: [
          { labelKey: "transactionList", href: "/admin/sales/transactions", icon: ListChecks },
          { labelKey: "transactionReceived", href: "/admin/sales/received", icon: Wallet },
          { labelKey: "transactionReceivable", href: "/admin/sales/receivable", icon: HandCoins },
        ],
      },
    ],
  },
  {
    titleKey: "groupRecruitment",
    items: [
      {
        labelKey: "recruitment", href: "/admin/recruitment", icon: UserPlus, badgeKey: "recruit",
        children: [
          { labelKey: "associatesList", href: "/admin/associates", icon: Users },
          { labelKey: "teams", href: "/admin/teams", icon: Network, roles: ["Admin"] },
        ],
      },
    ],
  },
  {
    titleKey: "groupFormsSubmission",
    items: [
      {
        labelKey: "groupFormsSubmission", icon: FileSignature,
        children: [
          { labelKey: "quotations", href: "/admin/quotations", icon: BadgeCheck, badgeKey: "quotations" },
          { labelKey: "splitApprovals", href: "/admin/split-approvals", icon: Split },
          { labelKey: "salesVerify", href: "/admin/sales/verify", icon: FileCheck },
          { labelKey: "referralPartnerships", href: "/admin/vendors", icon: Handshake, badgeKey: "referrals" },
          { labelKey: "agreements", href: "/admin/agreements", icon: FileSignature },
        ],
      },
    ],
  },
  {
    titleKey: "groupFinance",
    items: [
      { labelKey: "commission", href: "/admin/commission", icon: Calculator },
      { labelKey: "invoices", href: "/admin/invoices", icon: FileText },
      { labelKey: "payouts", href: "/admin/payouts", icon: Banknote },
    ],
  },
  {
    titleKey: "groupMarketing",
    items: [
      { labelKey: "nameCard", href: "/admin/name-card", icon: IdCard },
    ],
  },
  {
    titleKey: "groupProducts",
    items: [
      { labelKey: "products", href: "/admin/products", icon: Tags, roles: ["Admin"] },
    ],
  },
  {
    titleKey: "groupResources",
    items: [
      { labelKey: "notices", href: "/admin/notices", icon: Megaphone },
      { labelKey: "documents", href: "/admin/documents", icon: FolderOpen },
      { labelKey: "auditLog", href: "/admin/audit", icon: ScrollText, roles: ["Admin"] },
      { labelKey: "uat", href: "/admin/uat", icon: ClipboardCheck, roles: ["Admin"] },
    ],
  },
];

export const portalNav: NavGroup[] = [
  {
    titleKey: "groupPerformance",
    items: [
      {
        labelKey: "myDashboard", href: "/portal/dashboard", icon: LayoutDashboard,
        children: [
          { labelKey: "dashTransactionValue", href: "/portal/dashboard#transaction-value", icon: TrendingUp },
          { labelKey: "dashCommissionTransacted", href: "/portal/dashboard#commission-transacted", icon: Calculator },
          { labelKey: "dashCommissionReceived", href: "/portal/dashboard#commission-received", icon: Wallet },
        ],
      },
      {
        labelKey: "myTransactions", icon: Receipt,
        children: [
          { labelKey: "transactionList", href: "/portal/transactions", icon: ListChecks },
          { labelKey: "transactionReceived", href: "/portal/transactions/received", icon: Wallet },
          { labelKey: "transactionReceivable", href: "/portal/transactions/receivable", icon: HandCoins },
        ],
      },
      { labelKey: "myCommissions", href: "/portal/commissions", icon: Calculator },
      { labelKey: "myPayouts", href: "/portal/payouts", icon: Banknote },
      { labelKey: "teamSales", href: "/portal/team/sales", icon: Receipt, roles: MANAGER_ROLES },
      { labelKey: "teamCommissions", href: "/portal/team/commissions", icon: Calculator, roles: MANAGER_ROLES },
    ],
  },
  {
    titleKey: "groupRecruitment",
    items: [
      {
        labelKey: "groupRecruitment", icon: Users,
        children: [
          { labelKey: "associatesList", href: "/portal/recruitment/associates", icon: Users },
          { labelKey: "directRecruits", href: "/portal/recruitment/new", icon: UserPlus, roles: RECRUITER_ROLES },
          { labelKey: "downlineRecruits", href: "/portal/recruitment/downline", icon: GitBranch },
          { labelKey: "teamOverview", href: "/portal/team", icon: Network, roles: MANAGER_ROLES },
        ],
      },
    ],
  },
  {
    titleKey: "groupFormsSubmission",
    items: [
      {
        labelKey: "groupFormsSubmission", icon: FileSignature,
        children: [
          { labelKey: "transactionSubmission", href: "/portal/sales", icon: Receipt },
          { labelKey: "myQuotations", href: "/portal/quotations", icon: FileText },
          { labelKey: "referralSubmission", href: "/portal/referrals/new", icon: Handshake },
          { labelKey: "referralPartnerList", href: "/portal/referrals", icon: ListChecks },
          { labelKey: "agreements", href: "/portal/agreements", icon: FileSignature },
          { labelKey: "splitApprovals", href: "/portal/approvals", icon: BadgeCheck, roles: DIRECTOR_ROLES, badgeKey: "splitApprovals" },
        ],
      },
    ],
  },
  {
    titleKey: "groupMarketing",
    items: [
      { labelKey: "nameCard", href: "/portal/name-card", icon: IdCard },
      { labelKey: "flyers", icon: Image },
      { labelKey: "edm", icon: Mail },
      { labelKey: "customisation", href: "/portal/marketing/customisation", icon: Palette },
      { labelKey: "greetings", icon: PartyPopper },
    ],
  },
  {
    titleKey: "groupProducts",
    items: [
      { labelKey: "productsCatalogue", href: "/portal/products", icon: Store },
    ],
  },
  {
    titleKey: "groupResources",
    items: [
      { labelKey: "notices", href: "/portal/notices", icon: Megaphone, badgeKey: "notices" },
      { labelKey: "documents", href: "/portal/documents", icon: FolderOpen },
      { labelKey: "myPFile", href: "/portal/pfile", icon: FolderLock },
    ],
  },
];

export const navByArea = { admin: adminNav, portal: portalNav } as const;
export type ShellArea = keyof typeof navByArea;
