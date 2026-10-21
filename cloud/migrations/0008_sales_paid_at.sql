-- The admin's health check: every shop's payments in a few windows of time (cloud/src/admin.ts),
-- read without going through the whole ledger.
CREATE INDEX ix_sales_paid ON sales (paid_at);
