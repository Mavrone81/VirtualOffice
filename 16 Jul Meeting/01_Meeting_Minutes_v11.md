# Meeting Minutes — FINAL (v11)

**Virtual Office (VO) System — Meeting with Levi Jan Clavesillas**
16 July 2026 · Microsoft Teams · Reconciled against Whisper transcript + client clarifications (18 Jul 2026)

| Field | Detail |
|---|---|
| Date | July 16, 2026 |
| Duration | Approx. 1 hour 5 minutes |
| Basis | Teams recording (Whisper AI transcript) + v1 minutes + client answers |
| Version | v11 (FINAL) — Flow 4 (payment tracking) + precursor added; all 4 flows complete |
| Status | For sign-off & development |

> **How to read this document**
> 👤 Green = plain-language context for the Project Owner · 💻 Blue = technical requirements for the Developer · ⚠ Amber = a decision/clarification · 🔺 Red = a change/correction from the v1 minutes · ★ Two global rules apply system-wide (see Section 0A).

---

## 0. Summary of Changes Since v1 Minutes

| # | Area | What changed |
|---|---|---|
| 1 | Designations | **CORRECTED:** base role is SA (Sales Associate). SAM = Sales Assistant Manager (a manager role), SM = Sales Manager, SD = Sales Director. v1/v2 wrongly used "SAM" for the base associate. |
| 2 | Role permissions | SAM and SM carry employee-level feature access. Only Business Admin and SD hold elevated rights. |
| 3 | Commission split | Submitting associate (Associate 1) can assign split amounts to Associate 2 and Associate 3. Blank = 0; unassigned commission stays with Associate 1. |
| 4 | Sales targets | Employee view now includes a monthly quota and YTD sales (dollar value + transaction count) from 1 Jan. Visibility scoped by role. |
| 5 | Team membership | An associate can belong to multiple teams; team reporting shown as overall/aggregate at associate level. |
| 6 | Team creation | Admin-only team-creation module (was missing from v1). |
| 7 | Recruitment access | Invite candidate = SAM and above (SAM, SM, SD, Business Admin). SA excluded. |
| 8 | Digital namecard | Confirmed already live on the system — no action required. |

---

## 0A. Global Rules (apply system-wide)

- **★ Rule 1 — Percentage or absolute, 2 decimal places.** Every value field (commissions, splits, company profit, quotas, product amounts, overrides, etc.) must accept **either a percentage or an absolute amount**, entered to a maximum of 2 decimal places.
- **★ Rule 2 — Everything is audited.** All workflow steps, all approvals, and all system/data changes must be written to the audit log and be viewable there. Audit log view is Business Admin only.

Developer: provide a shared numeric input component (mode = % | absolute, precision 2 dp). Audit log captures actor, role, action, entity, before/after values, timestamp — including auto-approval events (logged as system-actor entries).

---

## 1. Role Model & Designations (corrected)

> 🔺 **CORRECTION:** v1/v2 used "SAM" for the base associate. The base role is **SA (Sales Associate)**. **SAM = Sales Assistant Manager** (a manager-level role).

| Code | Title | Access level | Defining right |
|---|---|---|---|
| Business Admin | System Administrator | Full | All system admin rights; final approval for commission payout |
| SD | Sales Director | Elevated | Approves submissions; auto-approves if not actioned within 3 days |
| SM | Sales Manager | Employee-level | Employee tools + recruit + team breakdown reporting |
| SAM | Sales Assistant Manager | Employee-level | Employee tools + can invite candidates |
| SA | Sales Associate | Employee (base) | Submit product, generate invoice, view own targets/namecard |

Recruitment (invite candidate) = SAM and above (SAM, SM, SD, Business Admin). SA excluded. SM and SAM grant no extra feature access vs SA — parity except recruitment and reporting scope.

---

## 2. Product Submission — Commission Split

- The submitter is **Associate 1** (primary) and by default earns the full **Net to Closer**.
- They may share with **Associate 2** and **Associate 3** (own-team dropdown; % of Net to Closer or absolute). Amounts given to 2/3 are deducted from Associate 1.
- If 2 and 3 are blank (= 0), the full amount stays with Associate 1.

> ⚠ **Confirmed:** the unassigned amount stays with Associate 1 (the submitting/primary associate).

---

## 3. Sales Targets & Amount

- Every associate sees a **Monthly Quota** (set by manager/director; Director overrides Manager) and **YTD sales** — shown as **both a dollar value and a transaction count** — from 1 January of the current year.
- An associate can belong to more than one team; at associate level, team figures are shown as an overall/aggregate.

| Role | Can see |
|---|---|
| Sales Associate (SA) | Own self + own team(s) overall (aggregate). No individual breakdown. |
| Managers (SAM / SM) | Same + breakdown of all own team(s)' data (drill into individuals). |
| Director (SD) | Same as manager + all of his managers' data (every team beneath). |

---

## 4. Transaction, Invoice & Approval Workflow

> ⚠ **Key decision:** Invoice generation = immediate, automatic, no approval gate. Approval workflow = commission payout only. Two independent processes.

- On submit: auto-generate invoice, downloadable immediately; not blocked by approval.
- Agreement document upload is **mandatory** on transaction submission.
- Approval chain: Associate → SD (verifies split) → Business Admin (verifies documents). SD auto-approves after 3 calendar days.
- Installment plans: 12 or 24 months; first month = deposit/booking fee (+ optional first installment).
- Installment tracking (marking each month paid) is Business Admin–only and manual for now.

---

## 5. Role-Based Access Matrix (corrected)

Columns: SA · SAM · SM · SD · Business Admin. Full grouped RBAC control matrix (all modules) is in the companion **VO RBAC Matrix** document.

| Feature / Page | SA | SAM | SM | SD | Bus. Admin |
|---|:--:|:--:|:--:|:--:|:--:|
| Submit product (transaction) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fill Associate 2 / 3 split | ✅ | ✅ | ✅ | ✅ | ✅ |
| Generate / download invoice (own) | ✅ | ✅ | ✅ | ✅ | ✅ |
| View sales targets & amount (own) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Download digital namecard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Notices / Documents / Partners (view) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Own team(s) overall (aggregate) data | ✅ | ✅ | ✅ | ✅ | ✅ |
| Team individual breakdown | ❌ | ✅ | ✅ | ✅ | ✅ |
| Invite candidate (recruitment) | ❌ | ✅ | ✅ | ✅ | ✅ |
| All managers/teams data (division) | ❌ | ❌ | ❌ | ✅ | ✅ |
| SD approval (commission split) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Admin approval (payout) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Team creation | ❌ | ❌ | ❌ | ❌ | ✅ |
| Partner approve / reject | ❌ | ❌ | ❌ | ❌ | ✅ |
| Audit log (view) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Product backend master | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 6. Clarifications — All Resolved

| # | Question | Resolution |
|---|---|---|
| 1 | Split input format | System-wide: percentage or absolute, to 2 decimal places (Global Rule 1). |
| 2 | YTD sales meaning | Show both dollar value and transaction count. |
| 3 | Associate seeing team data | Yes — SA sees team overall (aggregate). An associate can belong to multiple teams. |
| 4 | Designations | SA = Sales Associate (base); SAM = Sales Assistant Manager; SM = Sales Manager; SD = Sales Director. Recruitment = SAM and above. |
| 5 | Quota authority | Both Manager and Director may set; the Director's value overrides the Manager's. |
| 6 | Auditing | All workflow, approval and system changes are logged and viewable in the audit log (Global Rule 2). |

---

## 6A. Workflows

Four workflows: (1) Recruiting, (2) Product creation, (3) Product submission, (4) Payment tracking. Full detail with diagrams in the companion **VO System Workflows** document.

### 6A.1 Recruiting workflow

Setup: Business Admin creates/names teams; each team headed by one Director with many Managers & Assistant Managers.

| Step | Actor | Action |
|---|---|---|
| 0 | Business Admin | Create/name team; assign one Director + many Managers/Assistant Managers. |
| a | Recruiter | Invite candidate; select intended team (dropdown). Business Admin may set a Commencement Date on the invite. Invite link sends the full application form. |
| b | Applicant | Fill application form and submit. |
| c | System | Auto-generate sales agreement pre-filled from the application (incl. Marital Status + Spouse conflict). |
| d | Recruiter | Click SEND. Commencement Date = send date unless overridden at invite. |
| e | Candidate | Sign online and Submit. |
| f | Business Admin | Verify agreement and confirm (or return for amendment). |
| g | System | On confirm, associate fully onboarded. |

> ⚠ **Agreement gap fields — RESOLVED:** (1) Marital Status added to Application form V-2026-07; (2) Spouse conflict-of-interest added to V-2026-07; (3) Commencement Date = agreement send date, with Business Admin override on invite. Associate ID + Tier 1/2 Manager remain system-populated.

### 6A.2 Product creation workflow

Business Admin keys fields (each % or absolute, 2 dp). % entered shows the $ amount beside it (10% of a $10k sale = $1,000).

**Keyed:** Sales Amount, Closing Commission, SM Overriding, SD Overriding, Company Cut Pool.
**Calculated:**
- **Net to Closer = Closing Commission − Company Cut Pool**
- **Company Retained = Sales Amount − Closing Commission − SM Overriding − SD Overriding**

All % fields (including Company Cut Pool) compute on the Sales Amount.

*Worked example — $10k sale, 10% / 5% / 3% / 2%:* Closing $1,000, SM $500, SD $300, Cut Pool $200 → **Net to Closer $800**, **Company Retained $8,200** (balances to $10,000).

### 6A.3 Product submission workflow

Anyone (incl. Business Admin) selects a product. Submitter (Associate 1) is shown commission = Net to Closer; may split with Associate 2 & 3 (own-team dropdown; % of Net to Closer or absolute; primary auto-deducts).

On submit: invoice generated + two parallel tracks — (A) invoice payment tracking, (B) associate share-com approval: team SD (3-day auto-approve) → Business Admin → capture payout to associate DB for tracking + dashboard.

> ⚠ **Confirmed:** the associate 1/2/3 split divides **Net to Closer**, not the gross Closing Commission.

Invoice designed (Enshrine-branded): Bill-To, sales associate, line items, totals, one-time/12/24-month installment plan, PayNow/bank/cheque, required invoice-number reference. See companion Invoice Design.

### 6A.4 Payment tracking workflow

**Precursor:** after the invoice is generated, the rep (associate / his SM / his SD) gets the client to sign it, selects Installment (12/24) or Direct payment, and uploads the signed invoice (mandatory) before submitting for tracking.

**Payment tracking (Business Admin only):** two parts — installment and issued invoice (direct). Business Admin marks Paid/Unpaid.
- **Paid** → commissions accrue to each associate's account; invoice = **Payment Approved** (ready to pay).
- **Unpaid** → **Pending** (not ready).
- **Installment** — same, but only counts as Paid (releasing commission) after the designated installment is marked Paid.

> 🔺 **To confirm:** (1) installment trigger — you wrote the "tired" installment; confirm 3rd vs final. (2) Invoice access for signing extends to the associate + their SM + SD.

---

## 7. Action Items & Timeline

| # | Action | Owner | Due |
|---|---|---|---|
| 1 | Adopt Application form V-2026-07 (Marital Status + Spouse conflict); build commencement-date logic (send date + Business Admin override) | Client + Developer | Next build |
| 2 | Implement corrected designations (SA/SAM/SM/SD) + role model | Developer | By Tuesday |
| 3 | Global: percentage/absolute (2 dp) input component system-wide | Developer | By Tuesday |
| 4 | Global: audit log covering all workflow/approval/system changes | Developer | By Tuesday |
| 5 | Add Associate 1/2/3 commission split fields to submit form | Developer | By Tuesday |
| 6 | Add sales targets (quota + YTD $ & count) with role-scoped visibility | Developer | By Tuesday |
| 7 | Build product backend master + full approval workflow | Developer | In progress |
| 8 | Deliver prototype for testing | Developer | Tuesday |
| 9 | Deliver initial dashboard version | Developer | By Friday |

| Milestone | Target | Status |
|---|---|---|
| Workflow + corrected roles implemented | Tue, 22 Jul 2026 | Pending |
| Prototype ready for testing | Tue, 22 Jul 2026 | Pending |
| Core system go-live | Fri, 25 Jul 2026 | Pending |
| Dashboard — initial version | Fri, 25 Jul 2026 | Pending |

---

## Open Items

1. **Installment completion trigger** — 3rd vs final installment (commission release).
2. Confirm invoice-signing access set (associate + SM + SD).
