import {
  LayoutDashboard, UserPlus, Users, BadgeCheck, Receipt, Tags, Calculator,
  FileText, Banknote, Megaphone, FolderOpen, Handshake, FileSignature,
  IdCard, FolderLock, Network, ScrollText, ClipboardCheck, Split, FileCheck,
  TrendingUp, Wallet, HandCoins, ListChecks, Mail, Image, Palette,
  PartyPopper, Store, Sparkles, Landmark, Archive, Building2, type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@prisma/client";
import { RECRUITER_ROLES } from "@/lib/roles";

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
      { labelKey: "myDashboard", href: "/admin/dashboard", icon: LayoutDashboard },
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
      {
        labelKey: "groupFinance", icon: Landmark,
        children: [
          { labelKey: "commission", href: "/admin/commission", icon: Calculator },
          { labelKey: "invoices", href: "/admin/invoices", icon: FileText },
          { labelKey: "payouts", href: "/admin/payouts", icon: Banknote },
        ],
      },
    ],
  },
  {
    titleKey: "groupMarketing",
    items: [
      {
        labelKey: "groupMarketing", icon: Sparkles,
        children: [
          { labelKey: "nameCard", href: "/admin/name-card", icon: IdCard },
          { labelKey: "flyers", icon: Image },
          { labelKey: "edm", icon: Mail },
          { labelKey: "customisation", icon: Palette },
          { labelKey: "greetings", icon: PartyPopper },
        ],
      },
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
      {
        labelKey: "groupResources", icon: Archive,
        children: [
          { labelKey: "notices", href: "/admin/notices", icon: Megaphone },
          { labelKey: "documents", href: "/admin/documents", icon: FolderOpen },
          { labelKey: "auditLog", href: "/admin/audit", icon: ScrollText, roles: ["Admin"] },
          { labelKey: "uat", href: "/admin/uat", icon: ClipboardCheck, roles: ["Admin"] },
          { labelKey: "companyData", href: "/admin/company", icon: Building2, roles: ["Admin"] },
        ],
      },
    ],
  },
];

export const portalNav: NavGroup[] = [
  {
    titleKey: "groupPerformance",
    items: [
      // Associate-portal changes (Sep 2026, A1): plain links, no dropdowns.
      // The three transaction views are tabs on the My Transactions page.
      { labelKey: "myDashboard", href: "/portal/dashboard", icon: LayoutDashboard },
      { labelKey: "myTransactions", href: "/portal/transactions", icon: Receipt },
    ],
  },
  {
    titleKey: "groupRecruitment",
    items: [
      {
        labelKey: "groupRecruitment", icon: Users,
        // A8: Recruitment Dashboard (All / Direct / Downline associates) and
        // Downline Performance; the invite page stays for recruiters.
        children: [
          { labelKey: "recruitmentDashboard", href: "/portal/recruitment/associates", icon: Users },
          { labelKey: "downlinePerformance", href: "/portal/recruitment/downline", icon: TrendingUp },
          { labelKey: "directRecruits", href: "/portal/recruitment/new", icon: UserPlus, roles: RECRUITER_ROLES },
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
          { labelKey: "referralSubmission", href: "/portal/referrals/new", icon: Handshake },
          // A13: "Agreements" → "Doc Template" (blank templates to download).
          { labelKey: "docTemplate", href: "/portal/agreements", icon: FileSignature },
          { labelKey: "referralPartnerList", href: "/portal/referrals", icon: ListChecks },
        ],
      },
    ],
  },
  {
    titleKey: "groupMarketing",
    items: [
      {
        labelKey: "groupMarketing", icon: Sparkles,
        children: [
          { labelKey: "nameCard", href: "/portal/name-card", icon: IdCard },
          { labelKey: "flyers", icon: Image },
          { labelKey: "edm", icon: Mail },
          // B-9: this now serves the same download library as flyers/edm/
          // greetings — but Customisation itself pre-dates B-9, so its href
          // stays unconditional (unlike those three, which are flag-gated
          // below via MARKETING_LIBRARY_NAV_SLUG). The shipping config
          // (flag off) must keep this link working exactly as it did before.
          { labelKey: "chineseNameMenu", href: "/portal/marketing/customisation", icon: Palette },
          { labelKey: "greetings", icon: PartyPopper },
        ],
      },
    ],
  },
  {
    titleKey: "groupProducts",
    items: [
      { labelKey: "productsCatalogue", href: "/portal/products", icon: Store },
    ],
  },
  // A16 (Sep 2026): associates no longer get a Finance section — My
  // Transactions already shows commissions and what has been paid. The
  // /portal/commissions and /portal/payouts pages still exist (not deleted).
  {
    titleKey: "groupResources",
    items: [
      {
        labelKey: "groupResources", icon: Archive,
        children: [
          { labelKey: "notices", href: "/portal/notices", icon: Megaphone, badgeKey: "notices" },
          { labelKey: "documents", href: "/portal/documents", icon: FolderOpen },
          { labelKey: "myPFile", href: "/portal/pfile", icon: FolderLock },
        ],
      },
    ],
  },
  // Directors + admin only — every child is role-gated, so the whole section is
  // hidden from a plain associate (whose view then matches the sketch exactly).
  {
    titleKey: "groupMyTeam",
    items: [
      {
        labelKey: "groupMyTeam", icon: Network,
        children: [
          { labelKey: "teamOverview", href: "/portal/team", icon: Network, roles: DIRECTOR_ROLES },
          { labelKey: "teamSales", href: "/portal/team/sales", icon: Receipt, roles: DIRECTOR_ROLES },
          { labelKey: "teamCommissions", href: "/portal/team/commissions", icon: Calculator, roles: DIRECTOR_ROLES },
          { labelKey: "splitApprovals", href: "/portal/approvals", icon: BadgeCheck, roles: DIRECTOR_ROLES, badgeKey: "splitApprovals" },
        ],
      },
    ],
  },
];

export const navByArea = { admin: adminNav, portal: portalNav } as const;
export type ShellArea = keyof typeof navByArea;

// B-9: these items have no href above — the underlying pages exist
// (app/{admin,portal}/marketing/[category]) but 404 while
// MARKETING_LIBRARY_ENABLED is off, and nav.ts can't read that flag itself
// (see the comment above chineseNameMenu: importing @/lib/env here broke
// the shell for every signed-in user). The shell reads the flag server-side
// and passes it down as a prop instead; this map is pure data (safe to
// import from client code) letting the sidebar turn a labelKey into the
// matching /[area]/marketing/<slug> route.
//
// Deliberately NOT flyers/edm/greetings/customisation-portal's full set:
// the portal's "chineseNameMenu" (Customisation) pre-dates B-9 and already
// carries its own unconditional href above, so it's absent here on purpose
// — adding it back would make withMarketingLibraryHref a no-op for it
// either way (it only fills a MISSING href), but an entry for an item that
// never needs filling is misleading, not merely redundant. The admin-side
// "customisation" item has no such history (B-9 is its first page) and
// stays flag-gated like flyers/edm/greetings.
export const MARKETING_LIBRARY_NAV_SLUG: Record<string, string> = {
  flyers: "flyers",
  edm: "edms",
  customisation: "customisation",
  greetings: "greetings",
};

// Pure (no React, no env) so the sidebar's decision is directly testable —
// only ever fills in an href that's currently missing, so a NavItem that's
// unwired for a reason OTHER than this flag (nothing in that set today) is
// left alone.
export function withMarketingLibraryHref(item: NavItem, area: ShellArea, marketingLibraryEnabled: boolean): NavItem {
  const slug = MARKETING_LIBRARY_NAV_SLUG[item.labelKey];
  return slug && marketingLibraryEnabled && !item.href ? { ...item, href: `/${area}/marketing/${slug}` } : item;
}
