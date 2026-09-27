# ADR-0002: Admin uploads for Doc Template (B-5) and Marketing libraries (B-9)

- **Status:** Accepted with changes (2026-09-26): Dev Lead APPROVE-with-changes (rev 2) and DevSecOps APPROVE-with-changes (U1, U2, N5–N7), all applied in rev 3.
- **Owner:** Solution Architect · Builds on ADR-0001

## Context
- **B-5:** the admin uploads template files (PDF/JPG/PNG) into the Doc Template tabs Pets Afterlife / Human Afterlife. They sit
  **alongside** the generated agreements, and associates see them on their Doc Template page.
- **B-9:** four Marketing libraries (Flyers, EDMs, Customisation, Greetings) of named collections. PDF/JPG/PNG up to **20 MB**
  per file, no expiry. Associates browse and download.

Constraints found in the code and ops:
- Uploads go through **Server Actions**, capped at **10 MB** per request (`next.config.ts` `serverActions.bodySizeLimit`), and
  the action buffers the whole body in memory.
- The nginx body limit on the host is **not in the repo** (unverified; it must already exceed the ~5 MB onboarding upload).
- Files live on the local `vo_uploads` volume on a **shared droplet with a history of disk pressure**. The nightly backup
  tars the **whole** uploads volume and keeps **14** copies (`deploy/vo-backup.sh:32,77-80`), so every stored MB costs about
  15 MB of disk on that host.
- The `Document` model already stores admin documents, with assignment (All/Team/Associate) and a download route by id
  (`app/documents/[id]/download`).

## Decision
1. **B-5 reuses `Document`.** Add an additive `category` column (`PetsAfterlife`, `HumanAfterlife`, `null` = general). The
   associate Doc Template page lists the generated templates plus `Document` rows for that category with assignment `All`.
   Serving uses the existing `documents/[id]/download` route (ADR-0001), switched to SEC-11 headers. No new namespace.
2. **B-9 gets its own tables:**
   - `MarketingCollection` (library enum, name, sort, active);
   - `MarketingAsset` (collection FK, title, `file_key`, `display_name`, `mime` (sniffed), `size_bytes`, `sha256`,
     uploaded by/at, archived_at).
   Keys follow `marketing/<asset-uuid>/<asset-uuid>.<sniffed-ext>`. Serving is `GET /marketing/files/[id]` (any signed-in
   user, active assets only).
3. **Large uploads use a route handler, not a Server Action.** `POST /admin/marketing/upload`:
   - admin-area only (Business Admin), via `auth()`, so it inherits SEC-2's live revalidation;
   - **CSRF (U1):** call the app's single same-origin helper, `isSameOrigin(req)` (`lib/same-origin.ts`), as the first statement,
     and return 403 before reading the body. It's the same rule Next applies to Server Actions: `Origin` is required (fail closed),
     and its host must equal the request's host. Route handlers don't get that check built in, and the `SameSite=Lax` cookie
     default is not a design guarantee. There's one CSRF helper for every raw POST route, never a second implementation;
   - refuses early on `Content-Length` > 20 MB, before reading the body;
   - streams the request to a temp file in `STORAGE_DIR/.tmp/` (excluded from the backup), counting bytes and **aborting
     past 20 MB** whatever the header says; the temp file is removed in a `finally`, and a startup sweep clears any leftovers;
   - sniffs the magic bytes of the first chunk (SEC-11 `assertUpload`, pdf/png/jpeg only) and computes the SHA-256 while
     streaming;
   - renames the file into place, then inserts the row. If the insert fails, the file is deleted.

   The Server Action limit stays at 10 MB for everything else. **DevSecOps confirms the nginx body limit** for that one
   location (it needs ≥ 21 MB there only, not site-wide).
4. **A storage budget, enforced by the app.** Duplicates are detected by SHA-256 **within a collection only**: the upload is
   refused with a link to the existing asset. There is no cross-collection sharing, so deleting an asset never needs
   reference counting. **Enforced by the database (U2):** a partial unique index
   `(collection_id, sha256) WHERE archived_at IS NULL`. On `P2002` the handler deletes the file it just wrote and returns the
   "already exists" link. A check-then-insert alone would let two concurrent uploads both pass.
   An admin-visible "library size" figure is shown, and there is a configurable soft cap (default **2 GB** for Marketing):
   uploads warn at 80% and refuse at 100%. Archiving an asset hides it; deleting it (Business Admin, audited) frees space. **The 2 GB default and the backup change
   (point 5) are the owner's call**.
5. **The backup follows the storage (for DevSecOps / ops):** the owner's decision: before B-9 ships, the uploads backup becomes a
   **weekly full + nightly incremental** (the team writes it; the owner applies it on the server). It is re-downloadable collateral, not a record. **`STORAGE_DIR/.tmp/` is excluded**
   (`tar --exclude=./.tmp`; today the script tars the whole volume, `deploy/vo-backup.sh:80`). This stops 14 nightly full copies of a
   growing library. Signed and PII files keep the nightly full backup.

## Consequences
- ➕ There is no new serving code path; access is by record (ADR-0001). The size cap is enforced before the bytes hit memory.
- ➕ Disk growth on the shared host is bounded and visible, instead of being discovered when the disk fills.
- ➖ One route handler duplicates a little of the Server Action plumbing (auth, audit). Keep it small and tested.
- ➖ The backup change is an ops edit on the host, so it needs the owner's go like any host change.
- **Tests:**
  - a 20 MB + 1 byte upload is refused **without** buffering;
  - a wrong-type file is refused;
  - a duplicate SHA in the same collection is refused and linked; the same file in another collection is stored;
  - an oversized `Content-Length` is refused before any byte is written; an aborted upload leaves nothing in `.tmp/`;
  - archived assets return 404 to associates;
  - associates cannot reach the upload route (403);
  - a POST with a foreign `Origin` gets 403, and nothing is written (U1);
  - two parallel uploads of the same file produce one row and one file on disk (U2);
  - `GET /marketing/files/[id]`: signed-in only, active assets only, SEC-11 headers; admin archive and delete are audited (N6);
  - B-5 category rows show on the right tab only.
