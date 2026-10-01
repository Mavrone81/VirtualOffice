-- N2 reconciler (server/agreements/stuck-signed-reconciler.ts): an index
-- for the query that finds a PetsAshesAgreement stuck at Signed with no
-- agreementPdfKey. Purely additive — an index, no data change. No backfill.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pets_ashes_agreements_status_signed_at_idx" ON "pets_ashes_agreements"("status", "signed_at");
