-- Partner booking attribution: links a booking to a partner and snapshots the
-- commission at attribution time. The snapshot is immutable after creation so
-- that rate changes to the partner record never retroactively alter settled figures.
--
-- commission_amount_minor is the calculated commission for this booking in minor units.
-- settlement_id is NULL until the booking is included in a settlement batch.

CREATE TABLE IF NOT EXISTS partner_booking_links (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  partner_id            uuid        NOT NULL REFERENCES partner_organizations (id),
  booking_id            uuid        NOT NULL REFERENCES bookings (id),

  -- Commission snapshot (immutable — reflects the partner config at attribution time)
  gross_amount_minor    bigint      NOT NULL,           -- booking value used for commission calculation
  pax_count             int         NOT NULL DEFAULT 1,
  commission_type       text        NOT NULL CHECK (commission_type IN ('percentage', 'flat_per_booking', 'flat_per_pax', 'net_rate')),
  commission_rate       numeric(6, 4),
  commission_amount_minor bigint    NOT NULL,           -- calculated commission (0 for net_rate)
  commission_direction  text        NOT NULL CHECK (commission_direction IN ('partner_owes_tenant', 'tenant_owes_partner')),
  currency              char(3)     NOT NULL DEFAULT 'XCD',

  -- Settlement tracking
  settlement_id         uuid        REFERENCES partner_settlements (id),
  settled_at            timestamptz,

  -- Attribution source and external reference
  source                text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'ota_webhook')),
  external_ref          text,        -- OTA booking reference / confirmation code

  -- Soft delete (unlink without destroying audit trail)
  unlinked_at           timestamptz,
  unlinked_by           uuid,
  unlink_reason         text,

  created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by            uuid
);

-- One active link per booking per partner (prevent duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS partner_booking_links_unique_active
  ON partner_booking_links (tenant_id, partner_id, booking_id)
  WHERE unlinked_at IS NULL;

-- Fast lookup: unsettled links for a partner (used by settlement generation)
CREATE INDEX IF NOT EXISTS partner_booking_links_unsettled
  ON partner_booking_links (tenant_id, partner_id, settlement_id)
  WHERE settlement_id IS NULL AND unlinked_at IS NULL;

-- Lookup from booking detail: "is this booking attributed to a partner?"
CREATE INDEX IF NOT EXISTS partner_booking_links_by_booking
  ON partner_booking_links (booking_id)
  WHERE unlinked_at IS NULL;

-- RLS
ALTER TABLE partner_booking_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_booking_links_tenant_isolation ON partner_booking_links
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON partner_booking_links TO zettaz_runtime;
