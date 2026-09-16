-- Add dedicated base_currency column to tenants, backfilled from config JSONB
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS base_currency char(3) NOT NULL DEFAULT 'XCD';

-- Backfill from existing config where set
UPDATE tenants
   SET base_currency = config->>'reportingCurrency'
 WHERE config->>'reportingCurrency' IS NOT NULL
   AND config->>'reportingCurrency' != '';
