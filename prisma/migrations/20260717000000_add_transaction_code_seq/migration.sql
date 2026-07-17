-- Concurrency-safe transaction code counter (replaces the count()+1 race in
-- verifySubmission, where two concurrent verifications both counted N and both
-- emitted TXN-{N+1}). Postgres sequences serialize nextval; gaps on rollback are
-- acceptable for an opaque code.
CREATE SEQUENCE IF NOT EXISTS transaction_code_seq START 1;

-- Seed the sequence past any existing TXN codes so we never collide with
-- historical data. `false` => the given value is returned by the NEXT nextval.
SELECT setval('transaction_code_seq', COALESCE((SELECT COUNT(*) FROM sales_transactions), 0) + 1, false);
