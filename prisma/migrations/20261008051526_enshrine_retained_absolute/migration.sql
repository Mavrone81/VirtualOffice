-- Enshrine retained may be an absolute amount, not only a percentage
-- (owner CR1, 2026-10-08).
--
-- This was the only commission field locked to percentages. company_cut_pct,
-- sm_override_pct, sd_override_pct and md_cut_pct all already carry a
-- ComValueType; this one never did.
--
-- The precision is why it was percentage-only in practice, not just by
-- convention: DECIMAL(7,4) holds at most 999.9999, so it could never have
-- stored a dollar amount even if something tried. Widening matches the
-- siblings, which are all (14,4) for exactly this reason.
ALTER TABLE "products"
  ALTER COLUMN "external_company_retained_pct" TYPE DECIMAL(14,4);

-- Percentage default: every existing row holds a percentage today, so the
-- default preserves their current arithmetic exactly.
ALTER TABLE "products"
  ADD COLUMN "external_company_retained_type" "ComValueType" NOT NULL DEFAULT 'Percentage';
