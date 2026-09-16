-- Separate expense_currency, booking_currency, reporting_currency columns
-- so each can differ (multi-currency tenants: Rock Adventures XCD expenses,
-- USD bookings; Sint Maarten ANG local / USD both; etc.)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS booking_currency   char(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS expense_currency   char(3) NOT NULL DEFAULT 'XCD',
  ADD COLUMN IF NOT EXISTS reporting_currency char(3) NOT NULL DEFAULT 'XCD';

-- Backfill from existing config JSON (fall back to base_currency if not set)
UPDATE tenants SET
  booking_currency   = COALESCE(
    NULLIF(config->>'bookingCurrency', ''),
    base_currency,
    'USD'
  ),
  expense_currency   = COALESCE(
    NULLIF(config->>'collectionCurrency', ''),
    base_currency,
    'XCD'
  ),
  reporting_currency = COALESCE(
    NULLIF(config->>'reportingCurrency', ''),
    base_currency,
    'XCD'
  );

-- FX rate columns on expenses: store the actual bank rate used at time of entry
-- so reporting totals are frozen to the real cost incurred, not a retroactive estimate.
-- Both are NULL when expense_currency = reporting_currency (no conversion needed).
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS fx_rate               NUMERIC(14,6),  -- bank rate applied (e.g. 2.7169 XCD per USD)
  ADD COLUMN IF NOT EXISTS amount_reporting_minor bigint;         -- pre-computed: amount_minor × fx_rate, in reporting_currency

COMMENT ON COLUMN expenses.fx_rate IS
  'Actual bank sell/buy rate used at time of transaction. NULL when no FX conversion needed.';
COMMENT ON COLUMN expenses.amount_reporting_minor IS
  'Expense amount expressed in the tenant reporting_currency, frozen at entry time. NULL when no FX conversion needed.';
