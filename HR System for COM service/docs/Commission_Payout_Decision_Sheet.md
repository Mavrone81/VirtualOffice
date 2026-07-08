# Commission & Payout — Decision Sheet

**Product:** Enshrine Associate Management Portal (VirtualOffice)
**Purpose:** Lock the remaining commission-engine and payout/invoicing rules before the first live payout run.
**To be confirmed by:** Client / Vincent Lim (SD), with Accounts.
**Source:** PRD §16 (open items). The "Current build" column is what the system does **today** if left unchanged.

> How to use: for each row, tick **Keep default** or write the chosen alternative in the **Decision** column, then sign off at the bottom. Anything left blank ships with the current-build behaviour.

---

## A. Commission engine

| # | Decision | Current build (default) | Alternatives | Why it matters |
|---|----------|-------------------------|--------------|----------------|
| A1 | **Add-on com-code basis** (PRD §16.1) | Percentage is applied to the **line sale amount**. | Apply to the line **commission** instead. | Changes the size of every add-on payout. On a $10k line, 5% of sale = $500 vs 5% of a $1k commission = $50. |
| A2 | **Add-on attribution** (§16.2) | Paid entirely to the **closer**. | Split add-on with the upline chain. | Decides whether managers/directors share in add-on incentives or only the closer earns them. |
| A3 | **Installment recognition** (§16.3) | Commission becomes payable **all-at-once when the 3rd installment is received** (global threshold). | (a) Pro-rata — pay a slice per installment; (b) make the threshold **per-product** instead of global. | Governs cash-flow timing of every payout and how partial-payment deals are handled. |
| A4 | **Override chain depth** (§16.4) | **2 levels** — direct upline + second upline (ASM/SM/SD by rank). | Deeper chain (3+ levels). | Determines how far up a hierarchy an override reaches. Deeper = more of the pool paid out, less retained. |
| A5 | **Company Retained %** (§16.5) | **Derived** — retained = company-cut pool minus overrides paid; it absorbs the rounding residual. | Enter an **explicit** retained % and treat overrides separately. | Affects whether "retained" is a plug figure or a governed target the business can plan around. |
| A6 | **External-product economics** (§16.12) | External products (columbarium / niche / memorial / "Shifu") route the **bulk to the external provider**; Enshrine keeps `external_company_retained %` (**currently 0 unless set per product**); **no associate commission** paid on them. | Set a real retained % per external product, and/or pay a small associate commission from that retained cut. | Nothing is retained today unless a rate is entered per product — needs real numbers from Vincent before any external sale is processed. |

**Worked reference (current rules):**
- Internal $10,000 sale, closer 10%, company cut 40% → closer **$600**, SM override 20%×$400 = **$80**, SD override 10%×$400 = **$40**, company retained **$280**.
- Fixed $500 commission, same split → closer **$300**, SM **$40**, SD **$20**, retained **$140**.
- External $1,000 sale, 5% retained → provider **$950**, Enshrine **$50**, closer $0.

---

## B. Payout & invoicing

| # | Decision | Current build (default) | Alternatives | Why it matters |
|---|----------|-------------------------|--------------|----------------|
| B1 | **Payout timing / cadence** (§16.6) | Monthly batch payout, plus ad-hoc ("money-fall") runs. | Confirm the batch cadence (which day) and **which run generates the bank file**. | Sets the operational rhythm and which trigger produces the GIRO file Accounts uploads. |
| B2 | **Bank / GIRO file format** (§16.9) | Generic CSV bank file from the payout run. | Target a specific bank's **exact GIRO/bulk-payment spec** (DBS IDEAL, OCBC Velocity, etc.). | The file must match the paying bank's format byte-for-byte or the upload rejects. Needs the bank + a sample file confirmed. |
| B3 | **Invoice mode** (§16.7) | **One invoice per company entity** on a multi-entity sale. | Consolidated single invoice across entities. | Multi-product sales spanning entities either bill separately (per-entity) or merge — affects client-facing paperwork and GST. |
| B4 | **Company entities & invoice prefixes** (§16.10 / §16.13) | Three entities confirmed: **Enshrine Services / Enshrine Pets Paradise / Enshrine Afterlife Planner Pte Ltd**. Invoice prefixes and which products bill under which entity are **not yet set**. | Confirm each entity's invoice-number prefix and the product→entity mapping. | Every invoice needs a stable, per-entity numbering prefix; without it invoice numbers can't go live. |

---

## C. Out of scope for this sheet
The following PRD §16 items are **not** commission/payout decisions and are tracked separately:
- §16.8 — e-sign provider (in-house canvas is live).
- §16.11 — dashboard visibility of team-member-level detail to consultants.

---

## Sign-off

| Field | Value |
|-------|-------|
| Decided by | |
| Role | |
| Date | |
| Effective from | |

> Once returned, these answers are applied to the commission engine (`server/commission/`) and payout pipeline, and the affected products' rates are entered under **Admin → Products** before the first live run.
