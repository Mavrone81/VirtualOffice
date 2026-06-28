# Meeting Minutes — Enshrine Management Portal (Associate Management System)

**Project:** Enshrine Management Portal / Associate Management System ("virtual office")
**Source:** `MicrosoftTeams-video.mp4` (~71 min) → `MicrosoftTeams-video-transcript.txt`
**Meeting date:** _TBC_ (recording file dated 2026-06-27, which is the download date, not necessarily the meeting date)
**Language:** Mandarin + English (code-switching); minutes summarised in English
**Attendees:**
- **Samuel** — developer / system builder (RMA / Vorkhive)
- **Client** — Enshrine business owner(s) (pet afterlife & funeral services)
- _Referenced (not necessarily present):_ **Vincent** (owns the related CRM system), **Bincer & Silvia** (niche/columbarium economics), "Shifu" (master who creates niche placements)

> ⚠️ Transcribed by automatic speech recognition on mixed-language audio — some terms are approximate. Verify figures, names, and commercial terms against the source before acting.

---

## 1. Purpose

Scope a custom **management portal** ("virtual office") for Enshrine's sales associates, plus discuss
tweaks to the public **enshrinepets.com.sg** website. The portal is intended to run the full chain:
**recruitment → HR/associate master → sales submission → auto-commission engine → dashboards**, so that
associates and managers can self-serve online without coming into the office.

---

## 2. System modules discussed

### 2.1 Recruitment & HR (Associate Master)
- Recruitment form → submit → manager/HR approves → **auto-generate associate agreement → e-sign → virtual office account opens.**
- Associate master record: associate ID (auto-generated), up-line/down-line, full name, business name, phone, email, designation, etc.
- Data entry via manual key-in **or** bulk email/file upload (Samuel to follow the provided format/sample).
- **Status values:** Active / Suspended / "Dominator" / Inactive / **Pending** / **Approved** (approve after document & agreement reviewed and signed).
- E-sign caveat: digital signature on-screen may be hard for elderly signers → keep a fallback (download PDF, sign on iPad, re-upload).

### 2.2 Sales Submission
- Salesperson keys in a sale → system **auto-generates the sales transaction record + commission** (they do not hand-calculate).
- Captures product, associate, up-line, status, etc.

### 2.3 Auto-Commission Engine ⭐ (core)
- **Products** created with a product code (incl. external products: memorial, niche, etc.). Each product code tags its own commission rates.
- **Commission pool model:** a **company card** (e.g. 10% pool); direct up-line %, second up-line override, etc. all drawn **from the pool** so the total never exceeds it.
  - Example discussed: direct up-line 2%, second up-line 1%; change direct up-line to 1.5% from a date onward → all commissions recalculate automatically from that date.
- **Admin control:** product owner/admin logs in, creates products, sets % (or absolute amount), edits rates going forward.
- **Com codes (add-on commissions):** salesperson ticks applicable add-ons at submission (e.g. additional sea-scattering, remembrance) → extra commission (% of total or fixed amount) added on approval.
- **Worst-case fallback** for complex funeral/cascade/upgrade commissions: admin manually computes the up-line amount and keys it in.

### 2.4 Invoicing
- Generate invoice from the system; supports **different invoice types** (per company/brand — Enshrine, Trust Pets, etc., each with its own invoice number) **or consolidated** — client wants **different types**.
- Computer-generated invoices (no signature needed for these); reference to an accounting system ("Xero"-type) already in use.
- **Installments:** salesperson selects number of installments (e.g. 3/4/5/12 months) + deposit → system **auto-calculates** balance and pre-generates the installment invoices.
  - Renegotiated installments handled by either creating an extra "installment payment" product line and manually overwriting, or a **merge-invoices** function (Samuel to check feasibility).
- **GST:** none for now (revenue under S$1M). To be **added later** once GST-registered — Samuel to adjust the formula then.

### 2.5 Payments
- Most payments are **bank transfer**. A payment **gateway** (Stripe / HitPay / red dot) carries ~2–3% charge.
- **For now: manual.** Admin clicks "generate invoice" → manually tracks 2nd/3rd installment payments → once a payment lands, that portion's commission flips to **payable**.
- Gateway/Stripe integration is **Samuel's strength** but **deferred** (cost; revisit when volume grows / investor on board).

### 2.6 Dashboards
- **Director**, **Manager** (sees team), and **Personal** dashboards (individual performance, down-line, recruitment).
- Open debate: whether to show individuals their own performance numbers now — **decision: defer / optional**; keep simple while the team is small, expand later.

### 2.7 Payout summary
- Monthly summary of how much each associate receives.
- **Payout status:** Pending (e.g. under customer installment) / Approved / Paid / Cancelled.
- "On-hold" handling: keep simple — use **Pending** unless a dedicated hold state proves easy.

---

## 3. Additional client requests (parked / phased)

- **Festive marketing templates ("DM" / "festive" tab):** associates add their name/photo/number to a ready-made design and send to customers.
  - **AI auto-personalisation costs extra (external AI API charge) → deferred.** For now: a downloadable template where the associate adds their own number manually (like property-agent flyers).
- **Notices / notifications:** company-wide notices (e.g. clause/commission changes) appear in-system on the home page and via email; associates **download & save their own copy** (avoid system storage bloat). No long-term in-system inbox storage.
- **My Agreement / Documents folder:** associate keeps a copy of their signed associate agreement (download themselves); a company **documents folder** holds reusable agreements (referred-partnership agreement, cage-storage agreement, etc.).
- **Payroll → bank (GIRO):** HR system handles up to payroll; export a text file → upload to bank for salary GIRO. Note: manual transfers become unworkable past ~40 people, so this matters as the team grows.

---

## 4. Vendor / Logistics system (separate, future phase)

- A **separate system** from the HR/commission portal (more like an **LMS — logistics management system**), but high priority — client said the vendor system is arguably **more urgent** than the commission system.
- **Referred Partnership / Registration Record form:** records vendors / distribution centres (e.g. pet-level centre, groomers) with a **timestamp** to settle who referred a vendor first.
- **Vendor dispatch:** per-package vendor requirements pre-configured; admin clicks → list of vendor items → contact vendor directly by **WhatsApp/email** from the system; **backup-supplier auto-select** if first vendor unavailable; **full audit trail** (call logs, WhatsApp). Each vendor has its own message template.
- Samuel already has this "pure logistics system" and can adapt it; track which vendors/suppliers Enshrine uses, then refine together.

---

## 5. Website (enshrinepets.com.sg) — discussed in this meeting

_(These items were actioned separately — see the enshrinepets worklog.)_
- **Hero layout:** keep the navy on the left, change the right column to a contrasting **light-blue** block; client explicitly wants **strong contrast** with a **curved** cut between the two.
- **Heading "以欣慰送别 / 以奉敬传爱":** remove the comma; split onto the two lines (same for the English heading).
- **Nav order:** Home · Cremation · Religious Rites · Columbarium · Sea Scattering · Pricing.
- **Pricing page:** do **not** show prices (numbers too big / off-putting) — present **packages**, tailor a quote, and route to **Contact Us**.
- **Colour:** current navy is **too dark/deep** — wants a cleaner, peaceful, "chill" feel; reduce from 3 colours toward 2.
- **Hero image:** stock/bought images; set up a **carousel that rotates every ~2 months** (client supplies new images).
- **Chatbot:** there is a free scripted version; a paid version can actually converse / "re-buy" the visitor — optional upsell.
- Copywriting to be confirmed by the client/Vincent (Samuel won't write the copy).

---

## 6. Key decisions

1. Build the **Associate Management Portal** as a "virtual office": recruitment → HR master → sales submission → auto-commission → dashboards.
2. **Commission = pool-based** (company card %), with admin-editable product codes + add-on com codes; rate changes apply from a chosen date forward.
3. **Payments stay manual for now** (no payment gateway yet — avoid 2–3% fees); revisit Stripe later.
4. **Invoices: different types per brand**, computer-generated; installments auto-calculated.
5. **No GST yet** (under S$1M revenue) — add when registered.
6. **AI flyer personalisation deferred** (external API cost); ship plain downloadable templates first.
7. **Vendor/logistics system is a separate, important next phase** — Samuel to adapt his existing logistics system.
8. Website restyle approved (curved navy/light-blue hero, comma removal, nav order, lighter feel, image carousel).

---

## 7. Action items

| # | Action | Owner | Notes |
|---|--------|-------|-------|
| 1 | Build first cut of the portal with **mock data** and share a test sample | Samuel | "Rough" version by ~next morning; client reviews look & feel before full build |
| 2 | Follow the client's provided **data format/sample** for the associate master | Samuel | Manual entry + email/file upload |
| 3 | Implement **auto-commission engine** (pool/company-card, product codes, com codes, date-effective rates) | Samuel | Core module |
| 4 | Implement **sales submission + auto invoice** (different invoice types per brand, installments auto-calc) | Samuel | GST off for now |
| 5 | Implement **manual payment tracking** → commission becomes payable on payment | Samuel | Gateway deferred |
| 6 | Build **dashboards** (director / manager / personal) — keep simple initially | Samuel | Individual-performance visibility deferred |
| 7 | Add **notices/notifications** + **documents/agreement folders** (download-and-keep model) | Samuel | Avoid storage bloat |
| 8 | Ship **festive/marketing template** download (no AI yet) | Samuel | AI personalisation = paid add-on, later |
| 9 | Scope & adapt the **vendor/logistics system** (referred-partnership record, WhatsApp dispatch, audit trail, backup-supplier) | Samuel | Separate phase; track Enshrine's vendors/suppliers first |
| 10 | Provide **commission rates, com codes, product list, invoice samples, associate-agreement fields** | Client | Needed to configure the engine |
| 11 | Confirm **website copy** and supply **carousel images** | Client / Vincent | Samuel does design/adjustments, not copy |
| 12 | Provide payroll-bank (GIRO) **file format** when ready | Client | For salary upload |

---

## 8. Open questions / to confirm

- Exact **commission percentages**, company-card pool %, and which **com codes/add-ons** apply per product.
- **Installment** edge cases (renegotiation): merge-invoices vs. extra product line — Samuel to confirm what's feasible.
- Whether to show associates their **individual performance** now or later.
- **Pricing / commercials** for the portal: client noted "maybe more than $1, probably under $2" per ??? and that AI/gateway features add cost — final quote to be confirmed by Samuel.
- The actual **meeting date** (recording metadata only shows the download date).

---

*Minutes generated from a local AI transcript of the recording. Treat figures, names, and commercial terms as draft until verified against the audio.*
