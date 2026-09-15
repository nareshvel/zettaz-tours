-- 074: Platform-owned catalogs of vessels and ports, shared by every tenant.
--
-- These are the stable vocabulary behind a cruise call. The call itself
-- (vessel x port x date) stays tenant-owned in cruise_calls, because it is
-- dated operational data, not reference data. See
-- docs/MODULES/Tenant_settings/global-catalogs-plan.md.
--
-- No tenant_id: these rows belong to the platform. Every tenant reads them;
-- only the platform writes them (seed + importer). Tenants never mutate a
-- catalog row — they adopt a copy into their own table and edit that.

-- ─────────────────────────────────────────────────────────────────────────────
-- Vessels
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_vessels (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text        NOT NULL,
  name              text        NOT NULL,
  cruise_line       text,
  -- IMO ship identification number: 7 digits, assigned once and never reused,
  -- surviving rename and change of owner/flag. NULL until verified.
  imo               char(7)     CHECK (imo IS NULL OR imo ~ '^[0-9]{7}$'),
  passenger_capacity int        CHECK (passenger_capacity IS NULL OR passenger_capacity > 0),
  -- Whether this ship normally tenders rather than berthing. A default for the
  -- call form; the tenant can still override per call.
  tenders_by_default boolean    NOT NULL DEFAULT false,
  active            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at        timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS global_vessels_slug_key ON global_vessels (slug);
CREATE UNIQUE INDEX IF NOT EXISTS global_vessels_imo_key  ON global_vessels (imo) WHERE imo IS NOT NULL;
CREATE INDEX IF NOT EXISTS global_vessels_lookup ON global_vessels (active, name);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ports
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_ports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text        NOT NULL,
  name              text        NOT NULL,
  -- ISO 3166-1 alpha-2. Drives the "ports in my country first" default.
  country           char(2)     NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  -- Coarse cruising region for filtering: Caribbean, Mediterranean, Alaska,
  -- Baltic, Asia-Pacific, ... Free text rather than an enum so adding a region
  -- does not need a migration.
  region            text,
  -- UN/LOCODE: 5 chars, first two are the country. NULL until verified.
  locode            char(5)     CHECK (locode IS NULL OR locode ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
  timezone          text,
  latitude          numeric(9,6)  CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
  longitude         numeric(9,6)  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  active            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at        timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS global_ports_slug_key   ON global_ports (slug);
CREATE UNIQUE INDEX IF NOT EXISTS global_ports_locode_key ON global_ports (locode) WHERE locode IS NOT NULL;
CREATE INDEX IF NOT EXISTS global_ports_country ON global_ports (country, active, name);
CREATE INDEX IF NOT EXISTS global_ports_region  ON global_ports (region, active, name);

-- The LOCODE's country prefix must agree with the country column.
ALTER TABLE global_ports DROP CONSTRAINT IF EXISTS global_ports_locode_country_match;
ALTER TABLE global_ports
  ADD CONSTRAINT global_ports_locode_country_match
  CHECK (locode IS NULL OR left(locode, 2) = country);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION global_catalog_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS global_vessels_updated_at ON global_vessels;
CREATE TRIGGER global_vessels_updated_at
  BEFORE UPDATE ON global_vessels
  FOR EACH ROW EXECUTE FUNCTION global_catalog_set_updated_at();

DROP TRIGGER IF EXISTS global_ports_updated_at ON global_ports;
CREATE TRIGGER global_ports_updated_at
  BEFORE UPDATE ON global_ports
  FOR EACH ROW EXECUTE FUNCTION global_catalog_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Access: readable by every tenant, writable only by the owner (seed/importer)
-- ─────────────────────────────────────────────────────────────────────────────
-- No RLS: these carry no tenant data and are the same for everyone. Runtime
-- gets SELECT only, so an application bug cannot rewrite shared reference data.
GRANT SELECT ON global_vessels TO zettaz_runtime;
GRANT SELECT ON global_ports   TO zettaz_runtime;

-- ─────────────────────────────────────────────────────────────────────────────
-- Adoption: tenant rows record which catalog row they were copied from
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cruise_calls
  ADD COLUMN IF NOT EXISTS source_vessel_id uuid REFERENCES global_vessels(id),
  ADD COLUMN IF NOT EXISTS source_port_id   uuid REFERENCES global_ports(id);

ALTER TABLE accommodation_properties
  ADD COLUMN IF NOT EXISTS source_property_id uuid;

-- A tenant adopts a given catalog vessel+port pairing once per call date.
-- (cruise_calls already has UNIQUE(tenant_id, vessel_name, call_date, port_name);
-- this is the catalog-keyed equivalent so a rename cannot produce a duplicate.)
CREATE UNIQUE INDEX IF NOT EXISTS cruise_calls_source_unique
  ON cruise_calls (tenant_id, source_vessel_id, source_port_id, call_date)
  WHERE source_vessel_id IS NOT NULL AND source_port_id IS NOT NULL;

COMMENT ON COLUMN cruise_calls.source_vessel_id IS
  'global_vessels row this call was adopted from; NULL when the tenant typed the vessel name themselves.';
COMMENT ON COLUMN cruise_calls.source_port_id IS
  'global_ports row this call was adopted from; NULL when the tenant typed the port name themselves.';
