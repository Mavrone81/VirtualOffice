# VO System — Documentation Pack (16 Jul 2026 meeting)

Deliverables from the Virtual Office (VO) system requirements sessions with Levi Jan Clavesillas.

## Contents

| File | Description |
|---|---|
| 01_Meeting_Minutes_v11.md | Full reconciled meeting minutes — roles, global rules, workflows, clarifications, action items |
| 02_VO_System_Workflows_v7.md | The four workflows (recruiting, product creation, product submission, payment tracking) with step tables + field mapping |
| 03_VO_RBAC_Matrix.md | Role-based access control matrix across all modules for the 5 roles |
| 04_Enshrine_Associate_Application_V-2026-07.md | Updated application form structure (adds Marital Status + Spouse conflict) |

PDF versions of all documents (plus the Invoice Design and the fillable Application form) are in the accompanying PDF pack.

## Open items to confirm
1. Installment completion trigger — commission releases after the **3rd** or the **final** installment?
2. Invoice-signing access set — associate + their SM + SD (confirm).
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
# Virtual Office (VO) — System Workflows

**Companion to Meeting Minutes (16 Jul 2026) — Meeting with Levi Jan Clavesillas**
Draft v7 · Flows 1–4 detailed.

> Diagrams referenced below are in the PDF version. Each flow's step table carries the same content in text.

---

## 1. Recruiting Workflow

**Setup (prerequisite):** Business Admin creates and names teams. Each team is headed by exactly one Director and may have many Managers and Assistant Managers. A recruiter picks which team a candidate joins when sending the invite.

### Step-by-step

| Step | Actor | Action |
|---|---|---|
| 0 | Business Admin | Create and name the team. Assign one Director (head); attach Managers and Assistant Managers. |
| a | Recruiter | Invite the candidate. Select the intended team from a dropdown. Business Admin may optionally set a Commencement Date on the invite (otherwise defaults to the agreement send date). Invite link sends the full application form. |
| b | Applicant | Fill up the application form and submit. |
| c | System | Auto-generate a sales agreement pre-filled from the application-form data (incl. Marital Status and Spouse conflict declaration). |
| d | Recruiter | Click SEND to send the agreement. Commencement Date = this send date unless overridden at invite. |
| e | Candidate | Sign the agreement online and click Submit to return it. |
| f | Business Admin | Verify the agreement and confirm. If not in order, return for amendment / re-send. |
| g | System | Once confirmed, the associate is fully onboarded. |

### Field mapping (step c) — Application → Agreement

Templates: Associate Application (V-2026-07) + Associate Agreement (V.2026-04).

| Agreement field | Application source | Status |
|---|---|---|
| Name (as in NRIC/Passport) | Name as in NRIC | ✓ Mapped |
| Business Name | Business Name as in Business Card | ✓ Mapped |
| NRIC No | NRIC Number | ✓ Mapped |
| Nationality | Nationality | ✓ Mapped |
| Date of Birth | Date of Birth | ✓ Mapped |
| Gender | Sex | ✓ Mapped |
| Marital Status | Marital Status (added to form) | ✓ Mapped |
| Home Address | Residential Address (Block/Street/Unit/Postal) | ✓ Mapped |
| Mobile No | Mobile Number | ✓ Mapped |
| Religion | Religion | ✓ Mapped |
| Emergency contact (Name/Relationship/Address/Contact) | In the event of emergency block | ✓ Mapped |
| Spouse conflict Y/N + Company + Designation | Spouse / Conflict of Interest (added to form) | ✓ Mapped |
| Associate Name + NRIC (signature block) | Name + NRIC Number | ✓ Mapped |
| Commencement Date | Agreement send date (Business Admin can override on invite) | ✓ Resolved |
| Agreement execution date | — (date signed) | ⚙ System |
| Associate ID (For Official Use) | — (auto at onboarding) | ⚙ System |
| Tier 1 / Tier 2 Manager (For Official Use) | — (from team assignment) | ⚙ System |

> **GAP fields — RESOLVED:** Marital Status and Spouse conflict added to Application form V-2026-07; Commencement Date = agreement send date with a Business Admin override on the invite.

---

## 2. Product Creation Workflow

Business Admin keys a set of fields. Every field can be a percentage or an absolute amount (2 dp). When a % is entered, the system shows the $ equivalent beside it (10% of a $10k sale = $1,000).

### Product fields

| Field | Entry | Notes |
|---|---|---|
| Sales Amount | Absolute | The product price / total sale value. |
| Closing Commission | % or absolute | Commission for closing the sale (gross, before cut pool). |
| SM Overriding | % or absolute | Override to the direct upline (Sales Manager). |
| SD Overriding | % or absolute | Override to the second upline (Sales Director). |
| Company Cut Pool | % or absolute | Company's slice taken from the closing commission. |
| **Net to Closer** | Calculated | = Closing Commission − Company Cut Pool. |
| **Company Retained** | Calculated | = Sales Amount − Closing Commission − SM Overriding − SD Overriding. |

### Formulas

- **Net to Closer = Closing Commission − Company Cut Pool**
- **Company Retained = Sales Amount − Closing Commission − SM Overriding − SD Overriding**

All % fields (including Company Cut Pool) are computed on the **Sales Amount**. Company's total take = Company Retained + Company Cut Pool.

### Worked example (10% / 5% / 3% / 2% on a $10,000 sale)

| Field | Entered | Shown $ |
|---|---|---|
| Sales Amount | — | $10,000.00 |
| Closing Commission | 10% | $1,000.00 |
| SM Overriding | 5% | $500.00 |
| SD Overriding | 3% | $300.00 |
| Company Cut Pool | 2% | $200.00 |
| **Net to Closer** (= 1,000 − 200) | calc | **$800.00** |
| **Company Retained** (= 10,000 − 1,000 − 500 − 300) | calc | **$8,200.00** |

Balance: $800 + $500 + $300 + $8,200 + $200 = $10,000.

---

## 3. Product Submission Workflow

Anyone (incl. Business Admin) can submit a product. The submitter (Associate 1) is shown their commission = **Net to Closer**, and may split with Associate 2 & 3 (own-team dropdown; % of Net to Closer or absolute; primary auto-deducts). On submit, an invoice is generated and two parallel processes run.

### Step-by-step

| Step | Actor | Action |
|---|---|---|
| 1 | Any user | Select the product(s) to submit (Business Admin included). |
| 2 | System | Prompt shows the Primary Associate commission = Net to Closer for that product. |
| 3a | Submitter | Optionally add Associate 2 (dropdown, own team) + split (% of Net to Closer or absolute; $ shown beside %). |
| 3b | Submitter | Optionally add Associate 3 (same). |
| 3c | System | Primary amount = Net to Closer − (Associate 2 + Associate 3). If 2 & 3 blank, primary keeps full Net to Closer. |
| 4 | Submitter | Submit — triggers the product submission workflow. |
| 5 | System | Generate invoice (one-time or installment) — available for download. |
| 6 | System | Run two parallel tracks: A = invoice payment tracking (Flow 4); B = associate share-com approval. |
| B1 | Team SD | Approve the share-commission split. No action in 3 days = auto-approved. |
| B2 | Business Admin | Approve the commission table. |
| B3 | System | On approval, capture the com payout for each associate → tracked for payment + dashboard. |

> ⚠ **Confirmed:** the associate 1/2/3 split divides **Net to Closer** (not the gross Closing Commission).

### Invoice design

A system-generated Enshrine-branded invoice: Bill-To (customer), sales associate, product line + amount, subtotal/GST/total, payment plan (one-time or 12/24-month installment), payment methods (PayNow UEN / bank / cheque), and a required invoice-number reference so payments can be matched. See the separate **Invoice Design** PDF.

---

## 4. Payment Tracking Workflow

### 4.0 Precursor — invoice signing & submission for tracking

After a product is submitted and the invoice is generated, the sales representative — the associate, OR his SM, OR his SD — can access that invoice and get the client to sign on it. The rep selects a payment mode, and a signed-invoice file upload is mandatory before submitting for tracking.

| Step | Actor | Action |
|---|---|---|
| P1 | Rep / SM / SD | Access the generated invoice (submitting associate or their SM / SD in the chain). |
| P2 | Client | Sign on the invoice. |
| P3 | Rep | Select payment mode: Installment plan (12 / 24 months) OR Direct payment. |
| P4 | Rep | Upload the signed invoice file (mandatory). |
| P5 | Rep | Submit — the invoice enters payment tracking. |

### 4.1 Payment tracking (Business Admin)

Business Admin–only function. Tracks two parts: (1) Installment plans and (2) Issued invoices (direct payment). Business Admin updates each invoice's result as Paid or Unpaid.

| Step | Actor | Action |
|---|---|---|
| 1 | Business Admin | Open payment tracking (BA-only). View the two parts: Installment and Issued invoice (direct). |
| 2 | Business Admin | Direct payment: mark the invoice Paid or Unpaid. |
| 3 | System | If Paid → accrue commissions to each associate's account, set status **Payment Approved** (ready to pay). If Unpaid → **Pending**. |
| 4 | Business Admin | Installment: mark each installment Paid / Unpaid as payments come in. |
| 5 | System | Installment invoice is considered Paid only after the designated installment is marked Paid → then accrue commissions + Payment Approved. Until then → Pending. |

> 🔺 **To confirm:** installment completion trigger — you wrote the "tired" installment. Confirm whether commission releases after the **3rd** or the **final** installment. (Currently: "designated installment (3rd or final — to confirm)".)

**Developer notes:** restrict the whole payment-tracking module to Business Admin; two tracked types (direct single Paid/Unpaid, installment per-month schedule); on Paid, accrue each associate's Flow 3 split to their account and set Payment Approved; approved payouts feed the associate's payment record + dashboard; Pending payouts excluded from payment runs; log every change to the audit log.
# Virtual Office (VO) — RBAC Access Matrix

Role-based tab / feature access control · 5 roles.

**Roles:** SA = Sales Associate · SAM = Sales Assistant Manager · SM = Sales Manager · SD = Sales Director · Business Admin.
✅ = access, ❌ = no access. Enforce server-side, not only in the UI.

| Tab / Feature | SA | SAM | SM | SD | Business Admin |
|---|:--:|:--:|:--:|:--:|:--:|
| **A · Recruitment & Onboarding** | | | | | |
| Invite candidate (recruitment) — SAM and above | ❌ | ✅ | ✅ | ✅ | ✅ |
| Review own invited/pending candidates | ❌ | ✅ | ✅ | ✅ | ✅ |
| Verify & confirm agreement / onboarding | ❌ | ❌ | ❌ | ❌ | ✅ |
| **B · Sales & Transactions** | | | | | |
| Submit product / transaction — everyone incl. admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fill Associate 2 / 3 commission split | ✅ | ✅ | ✅ | ✅ | ✅ |
| Generate / download own invoice | ✅ | ✅ | ✅ | ✅ | ✅ |
| Select one-time / installment plan | ✅ | ✅ | ✅ | ✅ | ✅ |
| **C · Approvals** | | | | | |
| SD approval — associate share-com split | ❌ | ❌ | ❌ | ✅ | ✅ |
| Business Admin approval — commission payout | ❌ | ❌ | ❌ | ❌ | ✅ |
| **D · Dashboards & Reporting** | | | | | |
| Own performance dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Own sales targets & amount | ✅ | ✅ | ✅ | ✅ | ✅ |
| Own team overall (aggregate) data | ✅ | ✅ | ✅ | ✅ | ✅ |
| Team individual breakdown | ❌ | ✅ | ✅ | ✅ | ✅ |
| All managers / division data | ❌ | ❌ | ❌ | ✅ | ✅ |
| Set team member monthly quota — director overrides manager | ❌ | ✅ | ✅ | ✅ | ✅ |
| **E · Personal & Communications** | | | | | |
| Download digital namecard | ✅ | ✅ | ✅ | ✅ | ✅ |
| View notices | ✅ | ✅ | ✅ | ✅ | ✅ |
| View / download documents | ✅ | ✅ | ✅ | ✅ | ✅ |
| View partners (incl. MOQ) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **F · Content Management** | | | | | |
| Publish notices | ❌ | ❌ | ❌ | ❌ | ✅ |
| Upload / manage documents | ❌ | ❌ | ❌ | ❌ | ✅ |
| Partner approve / reject | ❌ | ❌ | ❌ | ❌ | ✅ |
| **G · Product & Finance (management)** | | | | | |
| Product creation / backend master (commission engine) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Payment tracking (mark Paid / Unpaid) — installment + direct | ❌ | ❌ | ❌ | ❌ | ✅ |
| Access invoice for client signing — own + rep's SM / SD | ✅ | ✅ | ✅ | ✅ | ✅ |
| Finance — all invoices | ❌ | ❌ | ❌ | ❌ | ✅ |
| Finance — commission & payout | ❌ | ❌ | ❌ | ❌ | ✅ |
| All transactions (company-wide) | ❌ | ❌ | ❌ | ❌ | ✅ |
| **H · Administration** | | | | | |
| Team creation | ❌ | ❌ | ❌ | ❌ | ✅ |
| Audit log (view) | ❌ | ❌ | ❌ | ❌ | ✅ |
| User / designation management | ❌ | ❌ | ❌ | ❌ | ✅ |

## Notes

- SAM and SM carry employee-level feature access; the differences vs SA are recruitment and team-level reporting. Only SD and Business Admin hold elevated approval/admin rights.
- Recruitment invite is open to SAM and above; the final agreement verification / onboarding confirmation is Business Admin only.
- Monthly quota may be set by SAM / SM / SD for their team; if a Director and a Manager both set a value, the Director's value overrides.
- All approvals, auto-approvals, payouts and configuration changes are written to the audit log (Global Rule 2); audit log view is Business Admin only.
- Own invoice generation is per associate; for client signing, an invoice can also be accessed by the submitting associate's SM and SD (chain oversight). Payment tracking (marking Paid/Unpaid) is Business Admin only.
- All value fields accept percentage or absolute amounts to 2 decimal places (Global Rule 1).
# Enshrine Associate Application — V-2026-07

*Enshrine Services Pte Ltd · Enshrine Pets Paradise Pte Ltd · Enshrine Afterlife Planner Pte Ltd*
74 Lorong 6 Geylang, Singapore 399226 · Tel: 9009 9234 · contacts@enshrine.sg · www.enshrine.sg

**Version note:** V-2026-07 — added **Marital Status** and a **Spouse / Conflict of Interest Declaration** (both marked below). This is the structure; the fillable form is the Word/PDF version.

---

## Applicant Particulars

| Field | | |
|---|---|---|
| Mr / Mrs / Ms / Mdm (Name as in NRIC) | Chinese Character | Photo |
| Business Name as in Business Card | Mobile Number | |
| Email Address | Home Number | |

**Residential Address:** Block / House No. · Street Name · Unit Number · Postal Code

**Identity:** NRIC Number · Date of Birth · Age · Sex (Male/Female) · **Marital Status (added)** · Religion · Nationality

## Family Details (Immediate Family / Spouse / Children)

Rows (×5): Name · Relationship · Age · Citizenship · Occupation · Dependent (Yes/No)

## Spouse / Conflict of Interest Declaration *(added)*

- **Is your spouse working and/or a supplier for a funeral and/or afterlife related company?**  Yes / No
- If yes — Name of Spouse · Name of Company · Designation

## In the Event of Emergency

Person to Call · Contact · Relationship · Address

## Language / Dialect Ability

Write / Speak · Dialects Spoken

## Education Qualifications (highest first)

Rows: Name of Institution · Certification · Year Obtained

## Past Work Experience (×3)

Per entry: Name of Company · Designation · Income From/To (Year) · Income Received (S$) · Reason for Leaving

## Other Information (Yes / No + details)

1. Have you ever worked in the funeral industry?
2. Have you ever been convicted in a court of law in any country?
3. Have you ever suffered from any physical / mental disability / impairment or have any incurring illness?
4. Have you ever been declared bankrupt?
5. Do you have any friend(s) or relative(s) in this company?
6. Do you possess a driving license?
7. Do you own a car?

## Declaration

I hereby declare that the information given by me in this form is correct and true to the best of my knowledge. I fully understand and accept that if at any time it is found that a false declaration has been made in this form, the company has absolute rights to terminate the agreement forthwith, unless otherwise stated.

*Applicant's Signature / Date* · *Interviewer's Comments & Signature / Date*

## Registration Criteria for New Salespersons

1. Must be at least 18 years old.
2. Must not currently be working and/or associated with any funeral related industry.
3. Must not have any judgement involving fraud, dishonesty or breach of fiduciary duties entered against them in civil proceedings.
4. Must not have been detained under the Misuse of Drugs Act or served with a detention / police supervision order under the Criminal Law (Temporary Provisions) Act.
5. All self-employed persons must register with the CPF Board on commencing business; under Section 3(I) of the CPF (Self-Employed Persons) Regulations, those earning yearly net trade income over $6,000 must contribute to Medisave.
6. All applicants doing full-time NS must attach a letter from the current Commanding Officer stating no restriction in the terms of employment, or a letter of approval to apply as a salesperson.
