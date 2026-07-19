// UAT case catalogue for the /uat tracker. Kept in code (not the DB) so cases
// are versioned with the build; only tester RESULTS are persisted. Case content
// is English — it is test-script material, not app UI, so it is not translated.

export type UatCase = { id: string; who: string; action: string; expect: string };
export type UatSection = { idx: string; title: string; tag: string; note?: string; cases: UatCase[] };

export const UAT_SECTIONS: UatSection[] = [
  {
    idx: "01", title: "Login & access smoke checks", tag: "Do first",
    cases: [
      { id: "1.1", who: "BA", action: "Log in as admin@enshrine.sg.", expect: "Lands on the Admin dashboard. Nav shows Recruitment, Associates, Teams, Sales Verify, Transactions, Products, Commission, Invoices, Payouts, Notices, Documents, Vendors, Name Card, Audit Log." },
      { id: "1.2", who: "ACC", action: "Log in as accounts@enshrine.sg.", expect: "Lands in the Admin area; finance sections (Invoices, Payouts, Transactions) visible. Teams and Audit Log are NOT shown." },
      { id: "1.3", who: "SD", action: "Log in as sylvia.lee.cx@gmail.com.", expect: "Portal dashboard. Nav has My Office (incl. My Invoices), My Team (Overview / Sales / Commissions, Recruitment, Split Approvals), Resources." },
      { id: "1.4", who: "SM", action: "Log in as franceskoohk@gmail.com.", expect: "Portal dashboard. My Team shows Recruitment but NOT Split Approvals (SD-only)." },
      { id: "1.5", who: "SA", action: "Log in as uma.devi.jennifer@gmail.com.", expect: "Portal dashboard. My Office incl. My Invoices. No My Team items, no Recruitment, no Split Approvals." },
      { id: "1.6", who: "SA / BA", action: "As an SA visit /admin/dashboard; as BA visit /portal/dashboard.", expect: "SA is redirected away; BA is redirected to the admin dashboard." },
      { id: "1.7", who: "SA", action: "Manually visit /portal/approvals and /portal/recruitment/new.", expect: "Both bounce to the Portal dashboard — the pages are not shown." },
      { id: "1.8", who: "ACC", action: "As Accounts, visit /admin/audit.", expect: "Redirected to the admin dashboard (audit is Business-Admin only)." },
      { id: "1.9", who: "ANY", action: "Switch language EN → 中文 and back on a dashboard.", expect: "Nav + headings translate; nothing shows a raw key like nav.myInvoices." },
      { id: "1.10", who: "ANY", action: "Avatar menu → Sign out.", expect: "Returned to /login; visiting a protected page redirects to login." },
    ],
  },
  {
    idx: "02", title: "Recruitment & onboarding", tag: "#12 · marital/spouse fields",
    cases: [
      { id: "2.1", who: "SD", action: "Go to Recruitment (/portal/recruitment/new), fill name/email/mobile/designation, submit.", expect: "Success; an onboarding link is produced. Copy it for 2.3." },
      { id: "2.2", who: "BA", action: "Admin → Recruitment → invite a candidate.", expect: "Same success + onboarding link." },
      { id: "2.3", who: "CAND", action: "Open the onboarding link in a fresh window. Check the details step.", expect: "Marital status dropdown present (Single/Married/Divorced/Widowed). Spouse-conflict question defaults to No; switching to Yes reveals Name of spouse / company / designation." },
      { id: "2.4", who: "CAND", action: "Set the conflict to Yes, leave spouse name/company blank, fill the rest, submit.", expect: "Rejected — spouse name + company are required. Filling them lets it submit." },
      { id: "2.5", who: "BA", action: "Open the submitted candidate in Recruitment.", expect: "Detail page shows Marital status and Spouse conflict of interest (Yes — spouse · company · designation, or No)." },
      { id: "2.6", who: "BA", action: "Approve the candidate.", expect: "A new associate code is issued, a login is provisioned, candidate no longer pending." },
      { id: "2.7", who: "SA", action: "Confirm no Recruitment link and /portal/recruitment/new is blocked.", expect: "No access (SAM+ only)." },
    ],
  },
  {
    idx: "03", title: "Sales, split approval & verification", tag: "SD split approval",
    note: "Setup — read first. The SD who approves a split is the closer's second upline (direct upline earns the SM override, the one above earns the SD override), so this needs a 3-level chain SD → SM → SA. The seeded data is mostly 2-level: first onboard a new associate under SM Frances Koo (EN0007) — Frances reports to SD Sylvia (EN0001) — and run 3.2–3.5 as that associate. Sylvia (sylvia.lee.cx@gmail.com) is the approving SD.",
    cases: [
      { id: "3.1", who: "SA", action: "My Sales → Submit sale. Client, date, a product line + amount (e.g. $10,000), Full payment. Submit.", expect: "Appears in My Sales as Submitted." },
      { id: "3.2", who: "SA*", action: "As the new SA under Frances, submit a sale with Associate 2 at 25% and Associate 3 at an absolute $100.", expect: "Accepted; the split is recorded." },
      { id: "3.3", who: "SD", action: "As SD Sylvia, open Split Approvals (/portal/approvals).", expect: "The 3.2 submission is listed with Associate 1/2/3 and an 'auto-approves in Nd' note. The sidebar Split Approvals badge shows a count." },
      { id: "3.4", who: "SD", action: "Click Approve split.", expect: "Row leaves the pending list; badge count drops." },
      { id: "3.5", who: "BA", action: "Sales Verify: try a NOT-yet-approved split, then the approved one.", expect: "Unapproved is blocked ('pending SD approval'); the approved one verifies into a Transaction." },
      { id: "3.6", who: "BA", action: "Find a submission older than 3 days with no SD action.", expect: "Business Admin can verify it without explicit SD approval (auto-approved by elapsed time)." },
      { id: "3.7", who: "SA", action: "Watch: as an SA with no second upline (e.g. Jennifer under SD EN0002), submit a sale.", expect: "No SD sees it in Split Approvals; a BA can only verify after the 3-day auto-approve. Flag if this blocks a real same-day sale." },
    ],
  },
  {
    idx: "04", title: "Commission engine correctness", tag: "money spot-check",
    cases: [
      { id: "4.1", who: "BA", action: "Verify a $10,000 internal sale on product FUN-BASE (closing 10% / cut 2% / SM 5% / SD 3%). Open its Commission.", expect: "Net-to-Closer $800, SM override $500 (direct upline), SD override $300 (second upline), company retained $8,400 — reconciles to $10,000. Needs the 3-level chain from Section 3." },
      { id: "4.2", who: "BA", action: "Verify a sale by an associate with no eligible upline in a position.", expect: "That override is paid to no one and falls into company retained instead." },
      { id: "4.3", who: "BA", action: "Inspect the 3.2 split sale's commission.", expect: "Associate 1 = Net-to-Closer − Associate 2 − Associate 3; SM/SD overrides and company retained unchanged by the split." },
    ],
  },
  {
    idx: "05", title: "Products — %-or-absolute overrides", tag: "product overrides",
    cases: [
      { id: "5.1", who: "BA", action: "Products → New. Percentage type, closing 10, overrides in % mode. Save.", expect: "Live preview shows the payout breakdown for the sample amount; Save works." },
      { id: "5.2", who: "BA", action: "Use the % / $ toggle on Company cut / SM / SD; switch one to $ and enter e.g. SM = $400. Save.", expect: "Toggle flips to $; preview recomputes using the fixed amount (not a %); Save works." },
      { id: "5.3", who: "BA", action: "With an override in % mode, check the '= $…' equivalent; change the preview sale amount.", expect: "The $ equivalent shows; changing the preview amount updates every line." },
      { id: "5.4", who: "BA", action: "Set commission type Fixed with a closing amount (e.g. $1,000).", expect: "Closing input switches to an amount; preview reflects a fixed closing." },
      { id: "5.5", who: "BA", action: "Tick External product and set the Enshrine-retained %.", expect: "Override fields are replaced by the retained field." },
      { id: "5.6", who: "BA", action: "Submit + verify a sale on the 5.2 product.", expect: "The ledger uses the absolute override (e.g. SM $400 flat), not a percentage." },
    ],
  },
  {
    idx: "06", title: "Invoices & payments", tag: "signed invoice",
    cases: [
      { id: "6.1", who: "BA", action: "Invoices → open a verified sale's invoice PDF.", expect: "The branded ENSHRINE invoice renders (UEN, Bill-To, Sales-Associate, line items, payment plan)." },
      { id: "6.2", who: "SA", action: "My Invoices (/portal/invoices).", expect: "Your invoices listed; 'Invoice ↗' opens the PDF; signed column shows Not signed." },
      { id: "6.3", who: "SA", action: "Click Upload signed and choose a PDF; then try a non-PDF.", expect: "PDF succeeds → column shows Signed ↗ and opens the file. A non-PDF is rejected." },
      { id: "6.4", who: "SA", action: "Review the My Invoices list.", expect: "An SA sees only their own invoices, not other associates'." },
      { id: "6.5", who: "BA", action: "Invoices → Mark paid an outstanding invoice, then Mark unpaid.", expect: "Status toggles both ways." },
      { id: "6.6", who: "BA", action: "On an installment plan, mark installments paid one by one.", expect: "Commission becomes eligible for release at the 3rd installment; reverting below the threshold reverts eligibility." },
    ],
  },
  {
    idx: "07", title: "Teams & quota", tag: "teams · membership",
    cases: [
      { id: "7.1", who: "BA", action: "Teams (/admin/teams) → create a team, set a director, add members.", expect: "Members appear under the team; the actions are recorded." },
      { id: "7.2", who: "SD/SM", action: "As the team's director/manager, open Team Overview (/portal/team).", expect: "Members shown match the explicit team from 7.1; team sales/commission tiles aggregate those members." },
      { id: "7.3", who: "SD/SM", action: "As a manager with no explicit team yet, open Team Overview.", expect: "Still shows their downline (not blank) — the fallback behaviour." },
      { id: "7.4", who: "SD/SM", action: "On Team Overview, set a member's monthly quota.", expect: "Saves and shows for the current month." },
      { id: "7.5", who: "SD/SM", action: "Attempt to set quota outside your team/downline.", expect: "Not allowed — authority is scoped to your team/downline." },
      { id: "7.6", who: "SD", action: "An SM sets a quota; an SD overwrites it; a lower authority tries to overwrite a higher one's.", expect: "SD can overwrite; a lower authority cannot overwrite one a higher authority set." },
    ],
  },
  {
    idx: "08", title: "Payouts & finance", tag: "BA / Accounts",
    cases: [
      { id: "8.1", who: "BA/ACC", action: "Open Payouts (/admin/payouts).", expect: "Monthly commission payouts per associate (personal / override / add-on / total)." },
      { id: "8.2", who: "BA", action: "Generate the bank / GIRO file.", expect: "A password confirmation is required before download (re-auth), and the action is audited." },
      { id: "8.3", who: "BA", action: "Mark a payout Paid.", expect: "It cannot be silently moved back out of Paid." },
    ],
  },
  {
    idx: "09", title: "Supporting modules", tag: "quick pass",
    cases: [
      { id: "9.1", who: "BA/SA", action: "BA posts a notice; an associate views it.", expect: "Associate sees an unread badge; marking read clears it." },
      { id: "9.2", who: "BA/SA", action: "BA uploads a document (All / Team / Associate).", expect: "The targeted associate can download it; others cannot." },
      { id: "9.3", who: "BA/SA", action: "BA adds a vendor.", expect: "It appears in the portal Vendor Registry." },
      { id: "9.4", who: "SA", action: "An associate opens their Name Card.", expect: "Shows their details / photo." },
      { id: "9.5", who: "BA", action: "Open Audit Log.", expect: "Recent actions (approvals, product/rate changes, split approvals, signed-invoice uploads, payout runs) are recorded with actor + timestamp." },
    ],
  },
];

export const UAT_TOTAL = UAT_SECTIONS.reduce((n, s) => n + s.cases.length, 0);
export const UAT_CASE_IDS = new Set(UAT_SECTIONS.flatMap((s) => s.cases.map((c) => c.id)));
