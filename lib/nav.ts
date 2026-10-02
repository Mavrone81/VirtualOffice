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
          { labelKey: "docTemplates", href: "/admin/doc-templates", icon: FileText },
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
    // C-7 (p.8): "Recruitment" renamed to "My Team" for the associate portal.
    // A SEPARATE, pre-existing "My Team" group below (`groupMyTeam`) already
    // carries that exact title for DIRECTOR_ROLES only (Team Overview/Sales/
    // Commissions/Split Approvals) — merging the two is a still-open question
    // with the owner. Until it's answered, this group gets its OWN key
    // (`groupMyTeamBase`, not `groupMyTeam`) so the two stay independently
    // renderable rather than accidentally coupled by sharing a translation
    // key. A Sales Associate/Assistant Manager never sees `groupMyTeam` at
    // all (role-gated out), so for them this is simply "My Team" with no
    // collision; a Director/Admin still sees two sections today (this one
    // plus the pre-existing one) until Q3 resolves the merge.
    titleKey: "groupMyTeamBase",
    items: [
      {
        labelKey: "groupMyTeamBase", icon: Users,
        // A8: Team Dashboard (All / Direct / Downline associates) and
        // Team Performance; the invite page stays for recruiters.
        children: [
          { labelKey: "recruitmentDashboard", href: "/portal/recruitment/associates", icon: Users },
          { labelKey: "downlinePerformance", href: "/portal/recruitment/downline", icon: TrendingUp },
          { labelKey: "directRecruits", href: "/portal/recruitment/new", icon: UserPlus, roles: RECRUITER_ROLES },
        ],
      },
    ],
  },
  {
    // C-6 (p.6): "Forms & Submission" renamed to "Submissions" for the
    // associate portal. Own key (`groupSubmissionsBase`), not a rewrite of
    // `groupFormsSubmission`, because adminNav's own "Forms & Submission"
    // group shares that key and is out of scope here.
    // Referral Partner List moved out to Resources, below Documents (C-6).
    // "Quotation Request" below: the form already exists at /portal/agreements,
    // itself gated behind A17_CLOSED_DEAL_FLOW — the owner's decision (relayed,
    // not guessed) is fail-closed: HIDDEN, not merely disabled, until A-17 is
    // live (see quotationRequestVisible below). Unlike the marketing-library
    // items, this one is NOT shown as a disabled "coming soon" row when off —
    // a shown item behind a disabled flow is a visible broken path for a real
    // associate; a hidden item that could have shown is just a question asked
    // later. The href is real and static (the page itself already flag-checks
    // server-side, redirecting to Documents when off); only the nav entry's
    // VISIBILITY is gated.
    //
    // C-6 (2026-10-02): the old "Doc Template" item is REMOVED, not renamed —
    // its Pets/Human Afterlife templates and signed-agreements list folded
    // into Documents below, so there's no separate destination left for it to
    // point to. The page that used to serve it (app/portal/agreements/page.tsx)
    // now serves only the quotation form; its URL/identity still carrying the
    // old name is a known, named follow-up (moving it to its own route), not
    // built here — see the comment at the top of that file.
    titleKey: "groupSubmissionsBase",
    items: [
      {
        labelKey: "groupSubmissionsBase", icon: FileSignature,
        children: [
          { labelKey: "transactionSubmission", href: "/portal/sales", icon: Receipt },
          // A-17 live-path finding: /portal/quotations (the old 16-Jul
          // quotation-to-close workflow — upload/sign the quotation, then
          // close the sale) carries real, live close-out actions for any
          // Legacy-flow sale still in flight, but had NO nav entry anywhere —
          // reachable only by typing the URL. Shown only to an associate who
          // actually has one (fail-closed, same pattern as C-6's
          // quotationRequestVisible): an entry that only exists with
          // something behind it can't be confused with "this workflow is
          // dead" the way a permanently-reachable-but-often-empty page could.
          { labelKey: "myQuotations", href: "/portal/quotations", icon: FileCheck },
          { labelKey: "referralSubmission", href: "/portal/referrals/new", icon: Handshake },
          { labelKey: "quotationRequest", href: "/portal/agreements", icon: BadgeCheck },
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
          // C-6 (p.6): moved here from Submissions, directly below Documents.
          { labelKey: "referralPartnerList", href: "/portal/referrals", icon: ListChecks },
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

// "My Quotations" has a real, static href regardless — this gates VISIBILITY
// (per-associate, computed server-side from a live DB count, never cached —
// see app/portal/layout.tsx), not the href itself, same shape as C-6's
// quotationRequestVisible but driven by data instead of a flag.
//
// INVARIANT this relies on: the count behind this predicate must stay a
// SUBSET of what app/portal/quotations/page.tsx itself queries (both key off
// closingAssociateId + status: QuotationApproved today; this predicate adds
// `flow: Legacy, transaction: null` on top). That containment is what makes
// "nav shows, page is empty" impossible by construction rather than by
// coincidence — the whole reason this item exists. Narrowing the PAGE's query
// later on some other axis (e.g. by submitting associate instead of closing
// associate) without narrowing this one the same way would break that and
// silently reintroduce the ambiguity this was built to remove. The two
// queries live in separate files and nothing enforces agreement between them
// — keep this comment in sync if either one changes.
export function myQuotationsVisible(item: NavItem, hasInFlightLegacyQuotation: boolean): boolean {
  return item.labelKey !== "myQuotations" || hasInFlightLegacyQuotation;
}

// C-6: "Quotation Request" (portalNav only) has a real, static href — the
// page it points to already flag-checks A17_CLOSED_DEAL_FLOW server-side —
// but nav.ts can't read that flag itself (same constraint as the
// marketing-library items), so VISIBILITY crosses the server/client boundary
// as this one boolean prop instead. Pure and named distinctly from
// `visible` (the role check in sidebar.tsx) because this is a flag gate, not
// a role gate, and only ever touches this one labelKey — everything else is
// unaffected regardless of the flag's value.
export function quotationRequestVisible(item: NavItem, quotationRequestEnabled: boolean): boolean {
  return item.labelKey !== "quotationRequest" || quotationRequestEnabled;
}
