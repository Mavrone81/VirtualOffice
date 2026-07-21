# Enshrine VirtualOffice — E2E Test Plan

**Environment:** https://vo.urbanwerkzsg.com
**Build under test:** `main` @ `aafae85` (VO v2 — 16-Jul meeting scope, complete)
**Date issued:** 2026-07-19

## How to use this document

1. Work top to bottom. **Section 1** is a login smoke test for every role — do it first; if a login fails, stop and report before continuing.
2. Each test has an ID, the account to use, steps, and the expected result. Tick the box when it passes.
3. To report an issue, note the **test ID**, what you saw vs. expected, the **account/role**, and a screenshot if possible.
4. The app is bilingual — use the **EN / 中文** toggle (top bar) to sanity-check both languages where noted.

> **Tip:** use a separate browser profile / incognito window per role so sessions don't collide. Log out between roles (avatar menu → Sign out).

---

## Test accounts

All accounts share the password **`Enshrine#2026`**. Log in at `/login` with the **email** as the username.

| Role | Login (email) | Name / Code | Notes |
|------|---------------|-------------|-------|
| Business Admin | `admin@enshrine.sg` | Admin | Full admin — products, teams, audit |
| Accounts | `accounts@enshrine.sg` | Accounts | Finance sub-role |
| Sales Director (SD) | `sylvia.lee.cx@gmail.com` | Sylvia Lee · EN0001 · *Sylvia Lee Division* | Directs a division; has a downline |
| Sales Director (SD) | `petafterlifesg@gmail.com` | Vincent Lim · EN0002 · *Vincent Lim Division* | Directs the division with 3 associates |
| Sales Manager (SM) | `franceskoohk@gmail.com` | Frances Koo · EN0007 | Under EN0001 |
| Sales Associate (SA) | `uma.devi.jennifer@gmail.com` | Jennifer RK · EN0003 | Under EN0002 |
| Sales Associate (SA) | `johnlee@mobilebellator.com` | John Lee · EN0004 | Under EN0002 |
| Sales Associate (SA) | `limwailee8200@gmail.com` | Lim Wai Lee · EN0005 | Under EN0002 |

> If a login is rejected, a Business Admin can reset it from **Admin → Associates → (person) → Reset password**. Report it as a finding either way.

---

## Section 1 — Login & access smoke checks (do first)

Goal: every role logs in, lands on the right home, and sees only the navigation it should.

- [ ] **TC-1.1 — Business Admin login.** Log in as `admin@enshrine.sg`. **Expect:** lands on the **Admin dashboard**. Left nav shows Recruitment, Associates, **Teams**, Sales Verify, Transactions, Products, Commission, Invoices, Payouts, Notices, Documents, Vendors, Name Card, **Audit Log**.
- [ ] **TC-1.2 — Accounts login.** Log in as `accounts@enshrine.sg`. **Expect:** lands in the **Admin** area. Finance sections (Invoices, Payouts, Transactions) are visible. **Teams** and **Audit Log** are **NOT** shown (Business-Admin only).
- [ ] **TC-1.3 — Sales Director login.** Log in as `sylvia.lee.cx@gmail.com`. **Expect:** lands on the **Portal dashboard** (not admin). Nav shows *My Office* (Dashboard, My Sales, My Commissions, My Payouts, **My Invoices**), *My Team* (Team Overview, Team Sales, Team Commissions, **Recruitment**, **Split Approvals**), and Resources.
- [ ] **TC-1.4 — Sales Manager login.** Log in as `franceskoohk@gmail.com`. **Expect:** Portal dashboard. *My Team* shows **Recruitment** but **NOT Split Approvals** (SD-only).
- [ ] **TC-1.5 — Sales Associate login.** Log in as `uma.devi.jennifer@gmail.com`. **Expect:** Portal dashboard. *My Office* is present (incl. **My Invoices**). No *My Team* items, **no Recruitment, no Split Approvals**.
- [ ] **TC-1.6 — Admin cannot reach portal / associate cannot reach admin.** As an **SA**, manually visit `/admin/dashboard` → **Expect:** redirected away (to portal/login). As **Business Admin**, visit `/portal/dashboard` → **Expect:** redirected to the admin dashboard.
- [ ] **TC-1.7 — Direct-URL guard (RBAC).** As an **SA**, manually visit `/portal/approvals` and `/portal/recruitment/new`. **Expect:** bounced to the Portal dashboard (not shown the page).
- [ ] **TC-1.8 — Audit log is Business-Admin only.** As **Accounts**, visit `/admin/audit`. **Expect:** redirected to the admin dashboard (no access).
- [ ] **TC-1.9 — Language toggle.** On any dashboard, switch **EN → 中文** and back. **Expect:** nav + headings translate; nothing shows a raw key like `nav.myInvoices`.
- [ ] **TC-1.10 — Sign out.** Use the avatar menu → Sign out. **Expect:** returned to `/login`; visiting a protected page redirects to login.

---

## Section 2 — Recruitment & onboarding  *(incl. #12 portal invite, (b) application fields)*

- [ ] **TC-2.1 — Portal invite by a manager (#12).** As **SD** (`sylvia.lee.cx@gmail.com`), go to **Recruitment** (`/portal/recruitment/new`). Fill name, email, mobile, intended designation, and submit. **Expect:** success; an onboarding link is produced. *(Copy the onboarding link for TC-2.3.)*
- [ ] **TC-2.2 — Admin invite still works.** As **Business Admin**, go to Recruitment → invite a candidate. **Expect:** same success + onboarding link.
- [ ] **TC-2.3 — Onboarding form: marital status + spouse conflict (b).** Open the onboarding link from TC-2.1 in a fresh window. In *Your details*:
  - **Marital status** dropdown is present (Single / Married / Divorced / Widowed).
  - **"Is your spouse working for or supplying a funeral / afterlife company?"** defaults to **No**.
  - Switch it to **Yes** → **Expect:** Name of spouse / Name of company / Designation fields appear.
- [ ] **TC-2.4 — Conflict fields are required when "Yes".** With the conflict set to **Yes**, leave *Name of spouse* / *company* blank, fill the rest (NRIC, payment method, signature, accept agreement), submit. **Expect:** submission is **rejected** (spouse name + company required). Fill them in → submit succeeds.
- [ ] **TC-2.5 — Reviewer sees the declaration.** As **Business Admin**, open Recruitment → the submitted candidate. **Expect:** the detail page shows **Marital status** and **Spouse conflict of interest** ("Yes — <spouse> · <company> · <designation>" or "No").
- [ ] **TC-2.6 — Approve candidate → associate.** As **Business Admin**, approve the candidate. **Expect:** a new associate code is issued, a login is provisioned, and the candidate no longer appears as pending.
- [ ] **TC-2.7 — SAM+ gate.** As an **SA**, confirm there is **no** Recruitment link and `/portal/recruitment/new` is blocked (already covered by TC-1.7 — re-confirm).

---

## Section 3 — Sales submission, split approval & verification  *(incl. #8 SD approval)*

> **Setup — read first.** The **SD** who approves a split is the closer's **second upline** (direct upline earns the SM override, the one above earns the SD override). This needs a **3-level chain: SD → SM → SA.** The seeded data is mostly 2-level, so first create the chain: in **Section 2**, onboard a new associate under **SM Frances Koo (EN0007)** — Frances reports to **SD Sylvia Lee (EN0001)**, so the new associate's *second upline* is Sylvia. Run TC-3.2–3.5 as that new associate; **Sylvia (`sylvia.lee.cx@gmail.com`) is the approving SD.**

- [ ] **TC-3.1 — Submit a sale.** As any **SA** (e.g. `uma.devi.jennifer@gmail.com`), go to **My Sales → Submit sale** (`/portal/sales/new`). Enter client, sale date, a product line + amount (e.g. $10,000), payment plan **Full payment**. Submit. **Expect:** appears in *My Sales* as **Submitted**.
- [ ] **TC-3.2 — Sale with an Associate 2 / 3 split.** As the **new SA under Frances Koo** (see Setup), submit a sale and add **Associate 2** (pick a colleague) with e.g. **25%**, and **Associate 3** with an absolute **$100**. **Expect:** accepted; the split is recorded.
- [ ] **TC-3.3 — SD sees pending split approval (#8).** As the team **SD Sylvia** (`sylvia.lee.cx@gmail.com`), open **Split Approvals** (`/portal/approvals`). **Expect:** the TC-3.2 submission is listed with Associate 1 (closer), Associate 2, Associate 3 and an "auto-approves in Nd" note. The sidebar **Split Approvals badge** shows a count.
- [ ] **TC-3.4 — Approve the split.** Click **Approve split**. **Expect:** the row disappears from the pending list and the badge count drops.
- [ ] **TC-3.5 — Business Admin verify is gated on SD approval.** As **Business Admin**, go to **Sales Verify** (`/admin/sales/verify`). Try to verify a submission whose split has **NOT** yet been SD-approved. **Expect:** blocked with a "pending SD approval" message. Verify the TC-3.4 (approved) one → **Expect:** succeeds, becomes a **Transaction**.
- [ ] **TC-3.6 — 3-day auto-approve (spot check, optional).** Note any submission older than 3 days with no SD action. **Expect:** Business Admin can verify it even without an explicit SD approval (auto-approved by elapsed time).
- [ ] **TC-3.7 — Watch: 2-level closer (no second upline).** As an **SA with no second upline** (e.g. `uma.devi.jennifer@gmail.com`, directly under SD EN0002), submit a sale. **Expect / flag:** no SD will see it in Split Approvals; a Business Admin can only verify it after the **3-day** auto-approve. **Report this** if it blocks a real same-day sale — confirm it's acceptable behaviour.

---

## Section 4 — Commission engine correctness  *(spot-check the money)*

- [ ] **TC-4.1 — Canonical percentage sale.** Verify a **$10,000** internal sale on product **`FUN-BASE`** (closing **10%**, company cut **2%**, SM **5%**, SD **3%**). As **Business Admin**, open **Transactions** / **Commission** for it. **Expect:** Net-to-Closer **$800**, SM override **$500** (to the direct upline), SD override **$300** (to the second upline), company retained **$8,400**; the numbers reconcile to $10,000. *(Requires the 3-level chain from Section 3 for both overrides to appear.)*
- [ ] **TC-4.2 — Override only for an eligible, present upline.** For a sale by an associate with **no eligible upline in that position**, confirm that override amount is **not** paid to anyone and instead falls to **company retained**.
- [ ] **TC-4.3 — Split reduces the closer's share, not the overrides.** For the TC-3.2 split sale, confirm Associate 1's commission = Net-to-Closer − Associate 2 − Associate 3, while SM/SD overrides and company retained are unchanged.

---

## Section 5 — Products  *(incl. (d) %-or-absolute overrides)*

- [ ] **TC-5.1 — Create a percentage product.** As **Business Admin**, Products → **New**. Enter code/name, commission type **Percentage**, closing **10**, and keep the three overrides in **%** mode. **Expect:** the live **preview** shows the payout breakdown for the sample sale amount; Save works.
- [ ] **TC-5.2 — Absolute overrides (d).** Create/adjust a product and use the **% / $ toggle** on **Company cut**, **SM override**, **SD override** — switch one or more to **$** and enter an absolute amount (e.g. SM = **$400**). **Expect:** the toggle flips to `$`; the live preview recomputes using the fixed amount (not a percentage); Save works.
- [ ] **TC-5.3 — Preview `$` equivalent.** With an override in **%** mode, confirm the preview shows the `= $…` equivalent next to it for the sample sale amount, and that changing the **preview sale amount** updates every line.
- [ ] **TC-5.4 — Fixed closing commission.** Set commission type **Fixed** and a closing amount (e.g. $1,000). **Expect:** closing input switches to an amount; preview reflects a fixed closing.
- [ ] **TC-5.5 — External product.** Tick **External product** and set the Enshrine-retained %. **Expect:** the override fields are replaced by the retained field; a sale of such a product routes the bulk to the provider, Enshrine keeping only the retained %.
- [ ] **TC-5.6 — Absolute override flows to a real sale.** Submit + verify a sale on the TC-5.2 product. **Expect:** the commission ledger uses the **absolute** override amount (e.g. SM = $400 flat), not a percentage.

---

## Section 6 — Invoices & payments  *(incl. #10 signed-invoice upload)*

- [ ] **TC-6.1 — Generated invoice (admin).** As **Business Admin**, Invoices → open a verified sale's invoice PDF. **Expect:** the branded ENSHRINE invoice renders (UEN, Bill-To, Sales-Associate, line items, payment plan).
- [ ] **TC-6.2 — Portal invoice view (#10).** As the **closing SA**, go to **My Invoices** (`/portal/invoices`). **Expect:** your invoices are listed; "Invoice ↗" opens the generated PDF; the signed column shows **Not signed**.
- [ ] **TC-6.3 — Upload a signed invoice (#10).** Click **Upload signed** and choose a **PDF**. **Expect:** succeeds; the signed column becomes **Signed ↗** and opens the uploaded file. Uploading a non-PDF (e.g. a .jpg) is **rejected**.
- [ ] **TC-6.4 — Ownership guard.** Confirm an SA sees **only their own** invoices under My Invoices (not other associates').
- [ ] **TC-6.5 — Mark paid / unpaid (BA).** As **Business Admin**, Invoices → **Mark paid** an outstanding invoice, then **Mark unpaid** to revert. **Expect:** status toggles both ways.
- [ ] **TC-6.6 — Installment release at the 3rd installment.** For an installment plan, mark installments paid one by one. **Expect:** commission becomes eligible for release once the **3rd** installment is marked paid; reverting an installment below the threshold reverts eligibility.

---

## Section 7 — Teams & quota  *(incl. #7 teams, (c) membership-driven views)*

- [ ] **TC-7.1 — Create a team (BA).** As **Business Admin**, go to **Teams** (`/admin/teams`). Create a team, set a director, and **add members**. **Expect:** members appear under the team; actions are recorded.
- [ ] **TC-7.2 — Team view reflects membership (c).** As the team's **director/manager**, open **Team Overview** (`/portal/team`). **Expect:** the members shown match the **explicit team** you built in TC-7.1 (team sales / commission tiles aggregate those members).
- [ ] **TC-7.3 — Downline fallback (c).** As a **manager who has no explicit team yet**, open Team Overview. **Expect:** the view still shows their downline (not blank) — the fallback behaviour.
- [ ] **TC-7.4 — Set a member's quota.** As **SM/SD** (SAM+), on Team Overview set a **monthly quota** for a member. **Expect:** it saves and shows for the current month.
- [ ] **TC-7.5 — Quota authority is scoped.** Confirm a manager can set quota only for **their team/downline** members, not arbitrary associates.
- [ ] **TC-7.6 — Director overrides manager.** If an SM sets a quota, confirm an **SD** can overwrite it, but a lower authority **cannot** overwrite one a higher authority set.

---

## Section 8 — Payouts & finance  *(BA / Accounts)*

- [ ] **TC-8.1 — Payouts view.** As **Business Admin** (or **Accounts**), open **Payouts** (`/admin/payouts`). **Expect:** monthly commission payouts per associate (personal / override / add-on / total).
- [ ] **TC-8.2 — Re-auth before bank file.** Generate the bank/GIRO file. **Expect:** a **password confirmation** is required before the file downloads (re-auth gate), and the action is audited.
- [ ] **TC-8.3 — Payout is terminal once Paid.** Mark a payout **Paid**. **Expect:** it cannot be silently moved back out of Paid.

---

## Section 9 — Supporting modules  *(quick pass)*

- [ ] **TC-9.1 — Notices.** BA posts a notice; an associate sees it in the Portal with an unread badge; marking read clears the badge.
- [ ] **TC-9.2 — Documents.** BA uploads a document (All / Team / Associate); the targeted associate can download it; others cannot.
- [ ] **TC-9.3 — Vendors.** BA adds a vendor; it appears in the portal Vendor Registry.
- [ ] **TC-9.4 — Name card.** An associate opens their Name Card and it shows their details/photo.
- [ ] **TC-9.5 — Audit log (BA only).** As Business Admin, open Audit Log and confirm recent actions (approvals, product changes, split approvals, signed-invoice uploads, payout runs) are recorded with actor + timestamp.

---

## Sign-off

| | Name | Date | Result (Pass / Pass-with-issues / Fail) |
|---|------|------|------------------------------------------|
| Tester | | | |
| Reviewed by | | | |

**Issues found:** _list test IDs + brief description, attach screenshots._
