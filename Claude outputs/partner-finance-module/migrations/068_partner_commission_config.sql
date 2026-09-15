-- Add commission configuration to partner_organizations.
-- Extends the existing partner model with type classification, commission structure,
-- settlement schedule, and contract metadata. All monetary fields use amount_minor.
-- commission_direction drives accounting treatment:
--   partner_owes_tenant → OTA/wholesale (partner settles net to tenant)
--   tenant_owes_partner → referral/agency (tenant pays commission to partner)

ALTER TABLE partner_organizations
  ADD COLUMN IF NOT EXISTS partner_type text
    CHECK (partner_type IN ('ota', 'reseller', 'affiliate', 'wholesale')),

  -- Commission structure
  ADD COLUMN IF NOT EXISTS commission_type text
    CHECK (commission_type IN ('percentage', 'flat_per_booking', 'flat_per_pax', 'net_rate')),
  ADD COLUMN IF NOT EXISTS commission_rate    numeric(6, 4),          -- e.g. 0.2000 = 20%; NULL for flat types
  ADD COLUMN IF NOT EXISTS commission_amount_minor bigint,            -- fixed amount in minor units; NULL for percentage
  ADD COLUMN IF NOT EXISTS commission_direction text
    CHECK (commission_direction IN ('partner_owes_tenant', 'tenant_owes_partner')),
  ADD COLUMN IF NOT EXISTS commission_currency char(3) NOT NULL DEFAULT 'XCD',

  -- Settlement schedule
  ADD COLUMN IF NOT EXISTS settlement_schedule text
    CHECK (settlement_schedule IN ('monthly', 'biweekly', 'per_booking', 'custom', 'manual'))
    NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS settlement_day      int
    CHECK (settlement_day BETWEEN 1 AND 28),  -- day-of-month for monthly schedule
  ADD COLUMN IF NOT EXISTS payment_terms_days  int NOT NULL DEFAULT 30,

  -- Invoice preference (separate from existing collection_mode)
  ADD COLUMN IF NOT EXISTS requires_formal_invoice boolean NOT NULL DEFAULT false,

  -- Contract metadata
  ADD COLUMN IF NOT EXISTS contract_ref        text;

-- Index: find all partners with a given settlement schedule for automated triggers (Track B)
CREATE INDEX IF NOT EXISTS partner_orgs_tenant_schedule
  ON partner_organizations (tenant_id, settlement_schedule)
  WHERE settlement_schedule IS NOT NULL;

-- Index: unsettled partners by direction for Finance summary cards
CREATE INDEX IF NOT EXISTS partner_orgs_tenant_direction
  ON partner_organizations (tenant_id, commission_direction)
  WHERE commission_direction IS NOT NULL;
