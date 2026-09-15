-- 069: Partner booking attribution links.
-- Each row ties a booking to a partner with a computed commission snapshot.
--
-- bookings and partner_organizations use composite primary keys (tenant_id, id).
-- Do not REFERENCES bookings(id) or partner_organizations(id) alone.

CREATE TABLE IF NOT EXISTS partner_booking_links (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id             uuid        NOT NULL,
  booking_id             uuid        NOT NULL,

  -- snapshot of booking financials at link time
  gross_amount_minor     bigint      NOT NULL,
  pax_count              int         NOT NULL DEFAULT 1,

  -- snapshot of commission terms at link time
  commission_type        text        NOT NULL CHECK (commission_type IN ('percentage','flat_per_booking','flat_per_pax','net_rate')),
  commission_rate        numeric(6,4),
  commission_amount_minor bigint     NOT NULL,
  commission_direction   text        NOT NULL CHECK (commission_direction IN ('partner_owes_tenant','tenant_owes_partner')),
  currency               char(3)     NOT NULL DEFAULT 'XCD',

  -- settlement tracking (FK added in 070 after partner_settlements exists)
  settlement_id          uuid,
  settled_at             timestamptz,

  -- data provenance
  source                 text        NOT NULL DEFAULT 'manual'
                                     CHECK (source IN ('manual','import','ota_webhook')),
  external_ref           text,

  -- soft-delete for corrections
  unlinked_at            timestamptz,
  unlinked_by            uuid,
  unlink_reason          text,

  created_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by             uuid,

  FOREIGN KEY (tenant_id, partner_id) REFERENCES partner_organizations(tenant_id, id),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings(tenant_id, id)
);

-- Only one active link per booking per partner
CREATE UNIQUE INDEX IF NOT EXISTS partner_booking_links_unique_active
  ON partner_booking_links (tenant_id, partner_id, booking_id)
  WHERE unlinked_at IS NULL;

-- Fast lookup: unsettled links per partner
CREATE INDEX IF NOT EXISTS partner_booking_links_unsettled
  ON partner_booking_links (tenant_id, partner_id, settlement_id)
  WHERE settlement_id IS NULL AND unlinked_at IS NULL;

-- Fast lookup: all active links for a booking
CREATE INDEX IF NOT EXISTS partner_booking_links_booking
  ON partner_booking_links (tenant_id, booking_id)
  WHERE unlinked_at IS NULL;

-- RLS
ALTER TABLE partner_booking_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_booking_links_tenant ON partner_booking_links;
CREATE POLICY partner_booking_links_tenant ON partner_booking_links
  USING (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON partner_booking_links TO zettaz_runtime;
