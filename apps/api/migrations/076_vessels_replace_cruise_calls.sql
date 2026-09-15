-- 076: Collapse cruise calls into a single shared vessels catalog.
--
-- A dated vessel x port x call record was manpower-intensive to maintain and
-- earned nothing: what a booking actually needs is the ship's NAME, recorded
-- optionally, for the waiver and for emergency contact. reservations.resolveStay
-- already denormalises that into bookings.stay->>'vesselName'; cruise_call_id was
-- only a structured side-link.
--
-- So: cruise_calls is dropped, global_vessels becomes `vessels`, and the table
-- carries BOTH platform-seeded rows and tenant-added ones:
--
--   tenant_id IS NULL  -> seeded by the platform, visible to every tenant
--   tenant_id = <uuid> -> added by that tenant, visible only to them
--
-- One table means bookings gets a single FK target and the picker is one query.
-- RLS below stops a tenant mutating a seeded row.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. global_vessels -> vessels, with an optional owning tenant
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE global_vessels RENAME TO vessels;

ALTER TABLE vessels
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

-- slug is a seed/import key; tenant-added rows are keyed by name instead.
ALTER TABLE vessels ALTER COLUMN slug DROP NOT NULL;

DROP INDEX IF EXISTS global_vessels_slug_key;
DROP INDEX IF EXISTS global_vessels_imo_key;
DROP INDEX IF EXISTS global_vessels_lookup;

-- Seeded rows: slug and IMO are the natural keys, so an import cannot duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS vessels_global_slug_key
  ON vessels (slug) WHERE tenant_id IS NULL AND slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vessels_global_imo_key
  ON vessels (imo) WHERE tenant_id IS NULL AND imo IS NOT NULL;

-- Tenant rows: one entry per ship name per tenant, case-insensitively, so the
-- same ship cannot be typed in twice.
CREATE UNIQUE INDEX IF NOT EXISTS vessels_tenant_name_key
  ON vessels (tenant_id, lower(name)) WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vessels_visible ON vessels (tenant_id, active, name);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS: everyone reads the seeded rows; a tenant writes only its own
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vessels_read   ON vessels;
DROP POLICY IF EXISTS vessels_insert ON vessels;
DROP POLICY IF EXISTS vessels_update ON vessels;

CREATE POLICY vessels_read ON vessels FOR SELECT
  USING (tenant_id IS NULL
         OR tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

CREATE POLICY vessels_insert ON vessels FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

CREATE POLICY vessels_update ON vessels FOR UPDATE
  USING      (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

-- No DELETE policy and no DELETE grant: removal is a soft delete via `active`,
-- matching the rest of the schema and keeping older bookings resolvable.
GRANT SELECT, INSERT, UPDATE ON vessels TO zettaz_runtime;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bookings.vessel_id replaces bookings.cruise_call_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS vessel_id uuid REFERENCES vessels(id);

-- Any vessel name that existing calls referenced but the seed does not cover
-- becomes a tenant-owned row, so no booking loses its ship.
INSERT INTO vessels (tenant_id, name)
SELECT DISTINCT cc.tenant_id, cc.vessel_name
  FROM cruise_calls cc
 WHERE NOT EXISTS (
         SELECT 1 FROM vessels v
          WHERE v.tenant_id IS NULL
            AND lower(v.name) = lower(cc.vessel_name))
ON CONFLICT DO NOTHING;

-- Point each booking at its vessel, preferring the shared seeded row over a
-- tenant copy when both spell the same ship.
UPDATE bookings b
   SET vessel_id = pick.id
  FROM cruise_calls cc
  JOIN LATERAL (
        SELECT v.id
          FROM vessels v
         WHERE lower(v.name) = lower(cc.vessel_name)
           AND (v.tenant_id IS NULL OR v.tenant_id = cc.tenant_id)
         ORDER BY (v.tenant_id IS NOT NULL), v.id
         LIMIT 1
       ) AS pick ON true
 WHERE b.tenant_id = cc.tenant_id
   AND b.cruise_call_id = cc.id;

-- Re-express the stay/reference agreement in terms of vessel_id.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_stay_reference_kind;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_cruise_call_fk;
ALTER TABLE bookings DROP COLUMN IF EXISTS cruise_call_id;

ALTER TABLE bookings
  ADD CONSTRAINT booking_stay_reference_kind CHECK (
    (vessel_id IS NULL OR (stay->>'kind' = 'cruise' AND accommodation_property_id IS NULL)) AND
    (accommodation_property_id IS NULL OR (stay->>'kind' = 'hotel' AND vessel_id IS NULL))
  );

CREATE INDEX IF NOT EXISTS bookings_vessel_idx
  ON bookings (tenant_id, vessel_id) WHERE vessel_id IS NOT NULL;

COMMENT ON COLUMN bookings.vessel_id IS
  'Optional ship the guest arrived on. bookings.stay->>''vesselName'' keeps the name as recorded at the time, so a later rename or deactivation never rewrites history on a waiver.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Drop what is no longer referenced
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS cruise_calls;

-- global_ports only existed to describe a call. Operational meeting points are
-- pickup_locations (kind='port'), so this is redundant.
DROP TABLE IF EXISTS global_ports;
