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
