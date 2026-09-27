# ADR-0001: Serve stored files by entity id only

- **Status:** Accepted (PM-approved 2026-09-25; recorded 2026-09-26; Dev Lead APPROVE, DevSecOps APPROVE; their notes are folded into Decision 7–9)
- **Owner:** Solution Architect · **Reviewers:** Dev Lead, DevSecOps

## Context
All uploaded and generated files live in one object store (`lib/storage.ts`), addressed by a string key
(`associates/<id>/…`, `candidates/<id>/…`, `submissions/<id>/…`, `vendors/<id>/…`, `documents/…`, `notices/…`).

There are two ways files reach a browser today:
1. **Key-addressed:** `GET /api/files/[...key]`. The caller supplies the key, and the route decides access from the key's
   *shape* (its prefix).
2. **Entity-addressed:** e.g. `documents/[id]/download`, `notices/[id]/attachment`, `portal/invoices/[id]/signed`,
   `payouts/[id]/statement`. The caller supplies a record id. The route loads the record, applies that record's own access
   rule, and reads the key **stored on the record**.

Key-addressed access duplicates each entity's access rule as a path rule, and a parser must then keep the two in step. A
recent security fix hardened that parser (SEC-1). The next features (A-7 payment voucher, A-17 quotations and agreements,
B-5 Doc Template uploads, B-9 Marketing libraries) would each add a namespace and another path rule.

## Decision
1. **Every file a non-admin can fetch is served by a route keyed on the owning record's id.** Examples:
   `/portal/sales/[id]/documents/[docId]`, `/portal/transactions/[id]/voucher`, `/marketing/files/[id]`.
   The route loads the record and applies **the same scope check its page uses** (`assertInScope`, closer check, team
   assignment, …). It then streams the `fileKey` read from the database. A client-supplied key is never used to locate a file.
2. `/api/files/[...key]` becomes **admin-area only** as the next step, and is removed once admin pages link to entity routes.
   The SEC-1 allowlist stays in place until then.
3. `lib/storage.resolveKey` **rejects** malformed keys (empty, `.`/`..` segments, backslashes, characters outside the key
   alphabet) instead of cleaning them, so all reads and writes fail closed in one place.
4. **Drafts and informational documents are rendered on request** from database data: quotations, unsigned agreement
   drafts, and statements for payouts not yet Paid. Nothing is stored for them.
   **Issued financial documents are not re-rendered from live data.** Once an invoice, a payment voucher or a Paid-payout
   statement is issued, what the recipient downloads must never change. Each such document type picks one of:
   - **store at issue**, as an immutable file with a SHA-256;
   - **snapshot the fields** on its own row at issue, and render only from the snapshot.

   The choice is made per type, in that feature's design. Any document that carries a signature, and any upload, is stored:
   - as an **immutable version**, with a new key per version;
   - with a **SHA-256 recorded on the row**;
   - with an audit entry.
5. **Serving headers come from the app** (`objectResponseHeaders`, from SEC-11): a declared type from the extension the server
   chose at upload (the sniffed type, never the user's filename), `nosniff`, inline only for images/PDF, and a sanitised
   download filename taken from the display-name column.
6. **New namespaces need a record.** A feature that stores files adds a table (or rows) that owns them. Keys are
   `<namespace>/<record-uuid>/<server-chosen-name>.<sniffed-ext>`, and user-supplied filenames are kept only in a display
   column.
7. **One read rule per entity.** Each entity's read rule is **one shared function** (e.g. `canReadVoucher(principal, txn)`),
   called by both the page and the file route. Two copies of the rule is how drift and IDOR come back.
8. **Every entity file route has IDOR tests:** another associate → 403, anonymous → 401, archived or void record → 404. The
   malformed-key regression test (`lib/files-route.test.ts`) stays until `/api/files` is deleted, then moves to `resolveKey`.
9. **Download filenames** carry both an ASCII-safe `filename=` and an RFC 5987 `filename*=UTF-8''…`, taken from the display
   name, so CJK names survive.
10. **PII-bearing downloads are recorded before streaming (audit reliability, Tier A).** Any route that streams a stored object must call
   `nricDocumentFor(key)` (`server/documents/pii-documents.ts`) and, if it returns a match, write `document.pii_viewed` via `auditTx`
   **before** streaming. On failure it returns 503 and sends no bytes. That covers `/api/files` today and every future entity route.

## Consequences
- ➕ Access to a file is the same thing as access to its record. There is one rule per entity and no parallel path-based
  access list, so the whole class of key-parsing bugs goes away.
- ➕ A-7, A-17, B-5 and B-9 fit the rule with no new serving code, only one small route per entity.
- ➖ About 16 existing `/api/files/${key}` links (portal P-File, sale detail, quotations, agreements, vendors, admin pages) move
  to entity routes. Dev Lead to size this; it can be phased behind step 2.
- ➖ Rendering on request costs CPU per download. That is acceptable at current volume, and it removes stored copies that could
  go stale.
- Follow-ups:
  - DevSecOps keeps a regression test on malformed keys.
  - Database adds `sha256` + `version` where signed files are stored (SEC-10).
  - Signed-agreement NRIC columns are encrypted (SEC-12).
