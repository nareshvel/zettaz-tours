-- 068: Add commission configuration columns to partner_organizations.
-- Stores how a partner earns / pays commission and when settlements run.

ALTER TABLE partner_organizations
  ADD COLUMN IF NOT EXISTS partner_type          text     CHECK (partner_type IN ('ota','reseller','affiliate','wholesale')),
  ADD COLUMN IF NOT EXISTS commission_type        text     CHECK (commission_type IN ('percentage','flat_per_booking','flat_per_pax','net_rate')),
  ADD COLUMN IF NOT EXISTS commission_rate        numeric(6,4),                        -- 0.2000 = 20 %  (percentage only)
  ADD COLUMN IF NOT EXISTS commission_amount_minor bigint,                              -- minor units     (flat types only)
  ADD COLUMN IF NOT EXISTS commission_direction   text     CHECK (commission_direction IN ('partner_owes_tenant','tenant_owes_partner')),
  ADD COLUMN IF NOT EXISTS commission_currency    char(3)  NOT NULL DEFAULT 'XCD',
  ADD COLUMN IF NOT EXISTS settlement_schedule    text     CHECK (settlement_schedule IN ('monthly','biweekly','per_booking','custom','manual'))
                                                           NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS settlement_day         int      CHECK (settlement_day BETWEEN 1 AND 28),  -- day-of-month for monthly
  ADD COLUMN IF NOT EXISTS payment_terms_days     int      NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS requires_formal_invoice boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_ref           text;

CREATE INDEX IF NOT EXISTS partner_orgs_tenant_schedule
  ON partner_organizations (tenant_id, settlement_schedule)
  WHERE settlement_schedule IS NOT NULL;

CREATE INDEX IF NOT EXISTS partner_orgs_tenant_direction
  ON partner_organizations (tenant_id, commission_direction)
  WHERE commission_direction IS NOT NULL;
