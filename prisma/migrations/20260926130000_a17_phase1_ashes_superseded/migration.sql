-- A-17 phase 1 (✎6, decided with the Architect + DevLead, a17-design.md §4):
-- a signed Pets Ashes agreement whose product is removed by a later edit
-- becomes Superseded. Its own migration, nothing else in it — same reason as
-- the Verified value (20260926120000): Postgres allows ADD VALUE inside a
-- transaction (PG12+) but not using that new value in the same one. No data
-- change: nothing writes 'Superseded' to any row yet (phase 1, flag off).
ALTER TYPE "AshesAgreementStatus" ADD VALUE IF NOT EXISTS 'Superseded';
