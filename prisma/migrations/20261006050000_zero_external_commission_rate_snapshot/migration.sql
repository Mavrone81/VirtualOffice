-- External-commission rate_snapshot zeroing (item 4 follow-up). Before the
-- engine paid an associate on an external line, four rate_snapshot fields
-- on an external-flagged row were submitted-but-inert form defaults
-- (closing 100 / company cut 10 / SM override 3 / SD override 2 for a
-- Percentage product, from the new-product form's own internal defaults,
-- which this form does not vary by isExternal) — values nobody chose; the
-- engine never read them for an external line. The moment the engine reads
-- them, they are live. This zeros them on every row whose SNAPSHOT says
-- external.
--
-- Scoped to the SNAPSHOT's own isExternal flag, NOT the product's current
-- one: a product later switched back to internal must keep its real,
-- chosen rates untouched by this migration, even though its Product row
-- would then read isExternal = false.
--
-- This first statement covers PAYOUT: the engine reads the SNAPSHOT at sale
-- time (server/commission/inputs.ts toLineInput, via rateSnapshot), never
-- the live Product row directly, so the snapshot is the only place this bug
-- could actually pay out from. It does NOT cover re-propagation through the
-- edit screen, which reads the Product row — see the second statement
-- below, added once that gap was found and confirmed end to end.
--
-- rate_snapshot's rate fields are JSON STRINGS; isExternal is a JSON
-- BOOLEAN (confirmed against a real production row:
-- jsonb_typeof(rate_snapshot->'closingCommPct') = 'string',
-- jsonb_typeof(rate_snapshot->'isExternal') = 'boolean'). Every value
-- written below is '"0"'::jsonb (a JSON string), not a bare 0, so every
-- affected row's rate fields keep the exact JSON type
-- server/commission/inputs.ts's toLineInput already expects from every
-- other row.
--
-- closingCommFixed is zeroed too, also as the STRING "0", not SQL NULL:
-- the engine's own `commissionType === Fixed ? closingCommFixed :
-- pctOf(closingCommPct) ?? 0` fallback means NULL and "0" compute
-- identically either way, so this is purely for type consistency with the
-- other four fields (a JSON null here would be a third shape alongside
-- "string" and "boolean" with no behavioural reason to introduce it).
-- Zeroed unconditionally on every external row regardless of that row's
-- own commissionType, matching the other four fields: an unused field
-- (e.g. closingCommFixed on a Percentage-type row) zeroing to "0" changes
-- nothing the engine reads, so there is no row-type case to special-case
-- here, only the one WHERE clause below.
--
-- REVERSIBLE ONLY BY RE-ENTERING VALUES. The values zeroed here were never
-- chosen by anyone — they are inert form defaults that became live only
-- because of the engine change this migration accompanies — so that is an
-- acceptable property of this migration, not an oversight; stated plainly
-- so a later reader does not have to work it out from the absence of a
-- down migration.
UPDATE "commission_structure_versions"
SET "rate_snapshot" = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set("rate_snapshot", '{closingCommPct}', '"0"'::jsonb, true),
        '{closingCommFixed}', '"0"'::jsonb, true
      ),
      '{companyCutPct}', '"0"'::jsonb, true
    ),
    '{smOverridePct}', '"0"'::jsonb, true
  ),
  '{sdOverridePct}', '"0"'::jsonb, true
)
WHERE "rate_snapshot"->>'isExternal' = 'true';

-- SECOND STATEMENT, added once the first was found to be re-propagable: the
-- snapshot zeroing above closes PAYOUT (the engine reads the snapshot at sale
-- time, never the live Product row) but leaves OPEN re-propagation through
-- the edit screen, which reads the Product row, not the snapshot. Measured
-- end to end: the UPDATE above zeros the snapshot; the Product row (never
-- touched) still carries the pre-fix 100/10/3/2; the edit page
-- (app/admin/products/[id]/edit/page.tsx) prefills the form FROM THAT ROW;
-- the owner opens the screen to do exactly what this whole follow-up exists
-- to let him do — set externalCompanyRetainedPct — and
-- server/products/actions.ts's updateProduct detects a rate change by
-- diffing the submission against the ROW (changedCommissionFields(
-- canonicalFromRow(existing), canonicalFromInput(validInput))), finds one
-- (the retained-% he just typed), and on ANY detected change rewrites BOTH
-- the row and a brand-new rate_snapshot from the full submitted form —
-- silently reintroducing 100/10/3/2 into a fresh snapshot, with his edit as
-- the apparent cause. This statement zeros the same four columns plus
-- closing_comm_fixed on the Product row itself, closing that path at the
-- source for every existing row.
--
-- THE SCOPING IS DELIBERATELY THE OPPOSITE OF THE STATEMENT ABOVE, not an
-- inconsistency to tidy up. The snapshot UPDATE keys off the SNAPSHOT's own
-- isExternal so a product later switched back to internal keeps its real,
-- chosen historical rates — a past snapshot's truth doesn't change when
-- today's Product row does. This UPDATE keys off "products"."is_external"
-- instead, because the Product row IS the current-values mirror the edit
-- screen reads RIGHT NOW: what matters for re-propagation is whether the
-- product is external TODAY, not what some past snapshot happened to say.
-- The two WHERE clauses are expected to select different row sets on a
-- product that has ever flipped isExternal, and that is the fix working as
-- intended, not a bug.
--
-- Column types here are "numeric" (closing_comm_pct/closing_comm_fixed
-- Decimal(7,4)/Decimal(14,2), company_cut_pct/sm_override_pct/sd_override_pct
-- Decimal(14,4) — see prisma/schema.prisma's Product model), not the JSON
-- strings the snapshot UPDATE above writes — so every value here is the
-- plain numeric 0, not '"0"'::jsonb. company_cut_pct/sm_override_pct/
-- sd_override_pct are NOT NULL (DEFAULT 0 already); closing_comm_pct/
-- closing_comm_fixed are nullable, but zeroed to 0 rather than left NULL —
-- same reasoning as the snapshot statement's closingCommFixed: the engine's
-- own fallback treats NULL and 0 identically, so this is for the edit
-- screen's displayed value (which shows an EMPTY field for NULL,
-- commission-card.tsx's value={f.closingCommPct ?? ""}, not a "0" a reader
-- would recognise as zeroed) and for consistency with the other three, not
-- because the engine needs it.
UPDATE "products"
SET
  "closing_comm_pct" = 0,
  "closing_comm_fixed" = 0,
  "company_cut_pct" = 0,
  "sm_override_pct" = 0,
  "sd_override_pct" = 0
WHERE "is_external" = true;
